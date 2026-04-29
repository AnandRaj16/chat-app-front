"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ChatMessage = {
    id: number;
    text: string;
    self: boolean;
};

type ConnectionStatus =
    | "idle"
    | "connecting"
    | "reconnecting"
    | "open"
    | "closed";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT ?? "8080";

function resolveWsUrl(): string {
    if (process.env.NEXT_PUBLIC_WS_URL) {
        return process.env.NEXT_PUBLIC_WS_URL;
    }
    if (typeof window === "undefined") {
        return `ws://localhost:${WS_PORT}`;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:${WS_PORT}`;
}

// Excludes visually ambiguous characters (0/O, 1/I/L) so codes are easy to share.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateRoomCode(length = 6): string {
    let code = "";
    for (let i = 0; i < length; i++) {
        code += ROOM_CODE_ALPHABET[
            Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)
        ];
    }
    return code;
}

export default function Page() {
    const [name, setName] = useState("");
    const [roomId, setRoomId] = useState("");
    const [creating, setCreating] = useState(false);
    const [joined, setJoined] = useState(false);
    const [status, setStatus] = useState<ConnectionStatus>("idle");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [copied, setCopied] = useState(false);

    const wsRef = useRef<WebSocket | null>(null);
    const messageIdRef = useRef(0);
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    const nextId = () => ++messageIdRef.current;

    useEffect(() => {
        if (!joined) return;

        // These three captures live for the lifetime of this effect run and
        // are reset whenever the user leaves and re-joins. `cancelled` is set
        // by the cleanup function so any pending socket / timer becomes a
        // no-op even if it fires after teardown.
        let cancelled = false;
        let attempt = 0;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

        const connect = () => {
            if (cancelled) return;

            const ws = new WebSocket(resolveWsUrl());
            wsRef.current = ws;
            setStatus(attempt === 0 ? "connecting" : "reconnecting");

            ws.onopen = () => {
                if (cancelled) {
                    ws.close();
                    return;
                }
                attempt = 0;
                setStatus("open");
                ws.send(
                    JSON.stringify({
                        type: "join",
                        payload: { roomId },
                    }),
                );
            };

            ws.onmessage = (event) => {
                const text =
                    typeof event.data === "string"
                        ? event.data
                        : String(event.data);
                const self = text.startsWith(`${name}: `);
                setMessages((prev) => [
                    ...prev,
                    { id: nextId(), text, self },
                ]);
            };

            // We only react to onclose: per the WebSocket spec, a close event
            // always fires (after any error), so handling both would schedule
            // duplicate reconnect attempts.
            ws.onclose = () => {
                if (cancelled) return;
                attempt += 1;
                setStatus("reconnecting");
                const delay = Math.min(
                    RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
                    RECONNECT_MAX_DELAY_MS,
                );
                reconnectTimer = setTimeout(connect, delay);
            };
            ws.onerror = () => {
                // Swallow — the matching close event drives reconnect.
            };
        };

        connect();

        return () => {
            cancelled = true;
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            wsRef.current?.close();
            wsRef.current = null;
        };
    }, [joined, roomId, name]);

    useEffect(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);

    const handleCreateRoom = async () => {
        setCreating(true);
        // Brief visual delay so users register the action; room codes are
        // generated client-side because the server has no "create" concept —
        // a room exists implicitly the first time someone joins it.
        await new Promise((resolve) => setTimeout(resolve, 500));
        setRoomId(generateRoomCode());
        setCreating(false);
    };

    const handleJoin = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!name.trim() || !roomId.trim()) return;
        setMessages([]);
        setJoined(true);
    };

    const handleSend = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text) return;

        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        ws.send(
            JSON.stringify({
                type: "chat",
                payload: { message: `${name}: ${text}` },
            }),
        );
        setDraft("");
    };

    const handleLeave = () => {
        wsRef.current?.close();
        setJoined(false);
        setStatus("idle");
        setMessages([]);
    };

    const handleCopy = async () => {
        if (!roomId) return;
        try {
            await navigator.clipboard.writeText(roomId);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard API can fail under non-secure contexts (e.g. plain http
            // over LAN). Silently ignore — the code is still visible to copy.
        }
    };

    if (!joined) {
        return (
            <main className="flex min-h-svh items-center justify-center bg-background p-6 font-mono">
                <div className="w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-sm sm:p-8">
                    <div className="flex items-center gap-2">
                        <MessageCircle className="size-6" strokeWidth={2} />
                        <h1 className="text-2xl font-bold tracking-tight">
                            Real Time Chat
                        </h1>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        temporary room that expires after all users exit
                    </p>

                    <Button
                        type="button"
                        onClick={handleCreateRoom}
                        disabled={creating}
                        size="lg"
                        className="mt-6 h-11 w-full text-sm"
                    >
                        {creating ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                Creating room...
                            </>
                        ) : (
                            "Create New Room"
                        )}
                    </Button>

                    <form
                        onSubmit={handleJoin}
                        className="mt-3 flex flex-col gap-3"
                    >
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                            className="h-11 rounded-md border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                            autoFocus
                            required
                        />
                        <div className="flex gap-2">
                            <input
                                value={roomId}
                                onChange={(e) =>
                                    setRoomId(e.target.value.toUpperCase())
                                }
                                placeholder="Enter Room Code"
                                spellCheck={false}
                                autoCapitalize="characters"
                                className="h-11 flex-1 rounded-md border border-border bg-background px-3 text-sm tracking-widest outline-none placeholder:text-muted-foreground placeholder:tracking-normal focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                                required
                            />
                            <Button
                                type="submit"
                                variant="secondary"
                                size="lg"
                                className="h-11 px-5"
                            >
                                Join Room
                            </Button>
                        </div>
                    </form>
                </div>
            </main>
        );
    }

    return (
        <main className="flex min-h-svh flex-col items-center bg-background p-4 font-mono sm:p-6">
            <div className="flex w-full max-w-2xl flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
                <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                Room
                            </span>
                            <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-semibold tracking-widest">
                                {roomId}
                            </code>
                            <button
                                type="button"
                                onClick={handleCopy}
                                aria-label="Copy room code"
                                className="text-muted-foreground transition-colors hover:text-foreground"
                            >
                                {copied ? (
                                    <Check className="size-3.5" />
                                ) : (
                                    <Copy className="size-3.5" />
                                )}
                            </button>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            <StatusDot status={status} />{" "}
                            {statusLabel(status)} · signed in as{" "}
                            <span className="text-foreground">{name}</span>
                        </span>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleLeave}
                    >
                        Leave
                    </Button>
                </header>

                <div
                    ref={scrollerRef}
                    className="flex-1 space-y-2 overflow-y-auto px-4 py-4"
                    style={{ minHeight: "60vh", maxHeight: "70vh" }}
                >
                    {messages.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            No messages yet — say hi.
                        </div>
                    ) : (
                        messages.map((m) => (
                            <div
                                key={m.id}
                                className={cn(
                                    "max-w-[80%] rounded-lg px-3 py-2 text-sm break-words",
                                    m.self
                                        ? "ml-auto bg-primary text-primary-foreground"
                                        : "bg-muted text-foreground",
                                )}
                            >
                                {m.text}
                            </div>
                        ))
                    )}
                </div>

                <form
                    onSubmit={handleSend}
                    className="flex gap-2 border-t border-border p-3"
                >
                    <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={inputPlaceholder(status)}
                        disabled={status !== "open"}
                        className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                    />
                    <Button
                        type="submit"
                        size="icon"
                        disabled={status !== "open" || !draft.trim()}
                        aria-label="Send message"
                    >
                        <Send />
                    </Button>
                </form>
            </div>
        </main>
    );
}

function StatusDot({ status }: { status: ConnectionStatus }) {
    const color =
        status === "open"
            ? "bg-emerald-500"
            : status === "connecting" || status === "reconnecting"
              ? "bg-amber-500"
              : "bg-red-500";
    const animate =
        status === "connecting" || status === "reconnecting"
            ? "animate-pulse"
            : "";
    return (
        <span
            className={cn(
                "mr-1 inline-block size-2 rounded-full align-middle",
                color,
                animate,
            )}
        />
    );
}

function inputPlaceholder(status: ConnectionStatus) {
    switch (status) {
        case "open":
            return "Type a message…";
        case "connecting":
            return "Connecting…";
        case "reconnecting":
            return "Reconnecting…";
        case "closed":
            return "Disconnected";
        case "idle":
            return "";
    }
}

function statusLabel(status: ConnectionStatus) {
    switch (status) {
        case "idle":
            return "Idle";
        case "connecting":
            return "Connecting";
        case "reconnecting":
            return "Reconnecting…";
        case "open":
            return "Connected";
        case "closed":
            return "Disconnected";
    }
}

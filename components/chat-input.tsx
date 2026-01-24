"use client"

import { Send, FileUp, Smile } from "lucide-react"
import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  className?: string
}

export function ChatInput({ onSend, disabled, className }: ChatInputProps) {
  const [message, setMessage] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    adjustHeight()
  }

  const adjustHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (message.trim()) {
      onSend(message)
      setMessage("")
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    }
  }

  return (
    <div className={cn("w-full max-w-4xl mx-auto p-4", className)}>
      <div className="relative flex items-end gap-2 p-3 rounded-2xl bg-card/60 border border-border/50 backdrop-blur-md shadow-lg transition-all focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50">
        
        {/* Attachment Button */}
        <button 
          className="p-2 text-muted-foreground hover:text-primary transition-colors hover:bg-muted/50 rounded-full"
          title="Add attachment"
          disabled={disabled}
        >
          <FileUp size={20} />
        </button>

        {/* Text Area */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type your message anonymously..." // Title/Placeholder
          className="flex-1 bg-transparent border-none focus:outline-none resize-none py-2 max-h-[120px] scrollbar-thin scrollbar-thumb-primary/20 scrollbar-track-transparent text-foreground placeholder:text-muted-foreground/70"
          rows={1}
          disabled={disabled}
        />

        {/* Emoji Button (Optional decoration) */}
        <button 
          className="p-2 text-muted-foreground hover:text-accent transition-colors hover:bg-muted/50 rounded-full hidden sm:block"
          title="Add emoji"
          disabled={disabled}
        >
          <Smile size={20} />
        </button>

        {/* Send Button */}
        <button
          onClick={handleSend}
          disabled={!message.trim() || disabled}
          className={cn(
            "p-2 rounded-xl transition-all duration-300",
            message.trim() 
              ? "bg-gradient-to-r from-primary to-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/25 hover:scale-105" 
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          <Send size={20} className={cn(message.trim() && "fill-current")} />
        </button>
      </div>
      <div className="text-center mt-2">
        <p className="text-xs text-muted-foreground">
          Press <kbd className="hidden sm:inline px-1 py-0.5 rounded bg-muted text-muted-foreground border border-border">Enter</kbd> to send
        </p>
      </div>
    </div>
  )
}

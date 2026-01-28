"use client"

import Link from "next/link"
import { Menu, X } from "lucide-react"
import { useState } from "react"
import ConnectWallet from "./wallet-connector"
import { ThemeToggle } from "./theme-toggle"

export function Header() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <header className="fixed w-full top-0 z-50 blur-gradient border-b border-border/50">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">
              ⚫
            </span>
          </div>
          <span className="text-xl font-bold gradient-text">AnonChat</span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-8">
          <Link
            href="#features"
            className="text-sm hover:text-primary transition-colors"
          >
            Features
          </Link>
          <Link
            href="#security"
            className="text-sm hover:text-primary transition-colors"
          >
            Security
          </Link>
          <Link
            href="#community"
            className="text-sm hover:text-primary transition-colors"
          >
            Community
          </Link>
        </div>

        {/* CTA Buttons */}
        <div className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          {/* Connect Wallet button  */}
          <div
            className="w-full cursor-pointer px-4 py-2 text-sm rounded-lg  text-primary-foreground font-semibold"
          >
            <ConnectWallet />
          </div>
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden p-2 hover:bg-muted rounded-lg transition-colors"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {/* Mobile Navigation */}
      {isOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur">
          <div className="px-4 py-4 space-y-3">
            <Link
              href="#features"
              className="block text-sm hover:text-primary transition-colors"
            >
              Features
            </Link>
            <Link
              href="#security"
              className="block text-sm hover:text-primary transition-colors"
            >
              Security
            </Link>
            <Link
              href="#community"
              className="block text-sm hover:text-primary transition-colors"
            >
              Community
            </Link>

            <div className="pt-3 border-t border-border/50 space-y-2">
              <div className="flex items-center justify-center">
                <ThemeToggle />
              </div>
              {/* Connect Wallet button  */}
              <div className="w-full cursor-pointer px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-primary to-accent text-primary-foreground font-semibold">
                <ConnectWallet />
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

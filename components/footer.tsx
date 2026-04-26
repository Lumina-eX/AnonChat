"use client";

import Link from "next/link";
import Image from "next/image";
import { ExternalLink } from "./external-link";

export function Footer() {
  return (
    <footer className="border-t dark:border-muted border-border/50 py-12 bg-card/30 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-1 mb-4">
              <Image
                src="/anonchat-logo.webp"
                alt="AnonChat Logo"
                width={32}
                height={32}
              />
              <span className="text-lg font-bold gradient-text">AnonChat</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Secure anonymous communication for free minds.
            </p>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold mb-4">Product</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/#features" className="hover:text-primary transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/#security" className="hover:text-primary transition-colors">
                  Security
                </Link>
              </li>
              <li>
                <Link href="/chat" className="hover:text-primary transition-colors">
                  Start Chatting
                </Link>
              </li>
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat#-roadmap"
                  className="hover:text-primary transition-colors"
                >
                  Roadmap
                </ExternalLink>
              </li>
            </ul>
          </div>

          {/* Docs */}
          <div>
            <h3 className="font-semibold mb-4">Docs</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat/blob/main/docs/user-guide.md"
                  className="hover:text-primary transition-colors"
                >
                  User Guide
                </ExternalLink>
              </li>
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat/blob/main/SETUP.md"
                  className="hover:text-primary transition-colors"
                >
                  Setup Guide
                </ExternalLink>
              </li>
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat/blob/main/CONTRIBUTING.md"
                  className="hover:text-primary transition-colors"
                >
                  Contributing
                </ExternalLink>
              </li>
            </ul>
          </div>

          {/* Community */}
          <div>
            <h3 className="font-semibold mb-4">Community</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat"
                  className="hover:text-primary transition-colors"
                >
                  GitHub
                </ExternalLink>
              </li>
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat/issues"
                  className="hover:text-primary transition-colors"
                >
                  Report an Issue
                </ExternalLink>
              </li>
              <li>
                <ExternalLink
                  href="https://github.com/Lumina-eX/AnonChat/blob/main/CONTRIBUTING.md"
                  className="hover:text-primary transition-colors"
                >
                  Contribute
                </ExternalLink>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t dark:border-muted border-border/50 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © 2026 AnonChat. All rights reserved. Built for privacy.
          </p>
          <div className="flex gap-6">
            <Link
              href="#"
              className="text-muted-foreground hover:text-primary transition-colors text-sm"
            >
              Twitter
            </Link>
            <Link
              href="#"
              className="text-muted-foreground hover:text-primary transition-colors text-sm"
            >
              Discord
            </Link>

            <ExternalLink
              className="text-muted-foreground hover:text-primary transition-colors text-sm"
              href="https://github.com/Lumina-eX/AnonChat"
            >
              GitHub
            </ExternalLink>
          </div>
        </div>
      </div>
    </footer>
  );
}

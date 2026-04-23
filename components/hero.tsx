"use client";
import Link from "next/link";

export function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center pt-16 relative overflow-hidden">
      {/* Animated Gradient Background */}
      <div className="absolute inset-0 gradient-bg -z-10" />

      {/* Floating orbs for visual effect */}
      <div className="absolute top-20 left-10 w-72 h-72 rounded-full blur-3xl opacity-20 bg-gradient-to-r from-primary to-transparent float-animation -z-10" />
      <div
        className="absolute bottom-20 right-10 w-72 h-72 rounded-full blur-3xl opacity-20 bg-gradient-to-l from-accent to-transparent float-animation -z-10"
        style={{ animationDelay: "2s" }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Eyebrow Text */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border/50 mb-8">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="text-sm text-muted-foreground">
            The Future of Private Communication
          </span>
        </div>

        {/* Main Heading */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
          <span className="gradient-text">Speak Freely,</span>
          <br />
          <span>Stay Anonymous</span>
        </h1>

        {/* Subheading */}
        <p className="text-xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed">
          AnonChat redefines anonymous social networking with secure,
          identity-free communication in censorship-resistant decentralized
          communities. Your voice matters—without compromise.
        </p>
        {/* Powered by Stellar */}
        <div className="mb-6 flex justify-center">
          <div className="relative px-6 py-2 rounded-full border border-border/50 bg-card/60 backdrop-blur-sm">
            <span className="absolute inset-0 rounded-full bg-gradient-to-r from-primary to-accent opacity-30 blur animate-pulse" />
            <span className="relative text-sm font-semibold tracking-wide text-muted-foreground">
              ⚡ Powered by{" "}
              <span className="gradient-text font-bold">
                Stellar Blockchain
              </span>
            </span>
          </div>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
          <Link href="/chat">
            <button className="px-8 py-4 bg-gradient-to-r from-primary to-accent text-primary-foreground font-bold rounded-lg hover:shadow-lg hover:shadow-primary/50 transition-all duration-300 hover:scale-105 cursor-pointer">
            Start Chatting Now
          </button>
          </Link>
        
          <button className="px-8 py-4 border border-border/50 rounded-lg hover:bg-card/50 transition-all duration-300 font-semibold cursor-pointer">
            Learn More
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 pt-16 border-t border-border/50">
          <div className="text-center">
            <p className="text-3xl font-bold gradient-text">0</p>
            <p className="text-sm text-muted-foreground mt-2">Data Collected</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold gradient-text">∞</p>
            <p className="text-sm text-muted-foreground mt-2">
              Decentralized Nodes
            </p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold gradient-text">100%</p>
            <p className="text-sm text-muted-foreground mt-2">Encrypted</p>
          </div>
        </div>
      </div>
    </section>
  );
}

import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Security } from "@/components/security";
import { CTA } from "@/components/cta";
import { Footer } from "@/components/footer";


export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <Header />
      <Hero />
      <Features />
      <Security />
      <CTA />
      <Footer />
     
    </main>
  )
}

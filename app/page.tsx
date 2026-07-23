import Image from "next/image";
import NavCard from "@/components/NavCard";

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-white px-6 py-10 sm:px-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 -right-40 h-[36rem] w-[36rem] rounded-full bg-blue-300/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 -left-48 h-[36rem] w-[36rem] rounded-full bg-teal-200/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.08) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage:
            "radial-gradient(ellipse 70% 55% at 50% 45%, black 30%, transparent 85%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 55% at 50% 45%, black 30%, transparent 85%)",
        }}
      />

      <header className="relative flex justify-start">
        <Image
          src="/images/logo.png"
          alt="정책돋보기"
          width={520}
          height={260}
          priority
          className="h-auto w-80 sm:w-96"
        />
      </header>

      <main className="relative grid w-full max-w-4xl flex-1 -translate-y-10 grid-cols-1 place-content-center gap-8 self-center sm:grid-cols-2">
        <NavCard
          href="/blue-house"
          imageSrc="/images/blue-house.png"
          imageAlt="대한민국 청와대"
          label="청와대"
        />
        <NavCard
          href="/assembly"
          imageSrc="/images/assembly.png"
          imageAlt="대한민국 국회"
          label="국회"
        />
      </main>
    </div>
  );
}

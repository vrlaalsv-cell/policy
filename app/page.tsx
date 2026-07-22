import Image from "next/image";
import NavCard from "@/components/NavCard";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 sm:py-24">
      <header className="flex flex-col items-center gap-4 text-center">
        <Image
          src="/images/logo.png"
          alt="정책돋보기"
          width={520}
          height={170}
          priority
          className="h-auto w-full max-w-md"
        />
      </header>

      <main className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-8 sm:grid-cols-2">
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

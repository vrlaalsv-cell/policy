import Link from "next/link";
import Image from "next/image";

type NavCardProps = {
  href: string;
  imageSrc: string;
  imageAlt: string;
  label: string;
};

export default function NavCard({ href, imageSrc, imageAlt, label }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/5 sm:aspect-square"
    >
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        className="object-contain p-10 transition-transform duration-300 ease-out group-hover:scale-105"
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-300 ease-out group-hover:bg-black/60">
        <span className="translate-y-2 text-lg font-semibold text-white opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
          {label} 바로가기 →
        </span>
      </div>
    </Link>
  );
}

import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "대한민국 국회 | 정책돋보기",
};

export default function AssemblyPage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-6 text-center">
      <Image
        src="/images/assembly.png"
        alt="대한민국 국회"
        width={160}
        height={120}
        className="h-auto w-40"
      />
      <h1 className="text-2xl font-bold text-[#1a2f4b]">국회 대시보드 준비 중입니다</h1>
      <p className="max-w-md text-zinc-600">
        22대 국회의원 300명의 에너지 정책 발언·성향 분석 데이터를 정리하고 있어요. 완성되는 대로 이 화면에서 바로 확인하실 수 있습니다.
      </p>
      <Link
        href="/"
        className="rounded-full bg-[#1a2f4b] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#132338]"
      >
        메인으로 돌아가기
      </Link>
    </div>
  );
}

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "トップ" },
  { href: "/upload", label: "アップロード" },
  { href: "/results", label: "結果" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-white/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold uppercase tracking-[0.24em] text-white">
            A
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">AmpliFy風 Webアプリ</div>
            <div className="text-sm text-muted-foreground">
              PDF管理ワークスペースとIFCビューアの骨組み
            </div>
          </div>
        </div>
        <nav className="hidden items-center gap-2 md:flex">
          {navItems.map((item) => (
            <Button key={item.href} asChild variant="ghost" size="sm">
              <Link href={item.href}>{item.label}</Link>
            </Button>
          ))}
          <Badge variant="secondary">Next.js構成</Badge>
        </nav>
      </div>
    </header>
  );
}

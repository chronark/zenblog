import { ZendoLogo } from "@/components/ZendoLogo";
import Link from "next/link";
import { BsGithub } from "react-icons/bs";
import { SidebarLink, SidebarTitle } from "./ui/sidebar";
import { endpoints } from "app/api/public/[...route]/public-api.constants";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full max-h-[90vh] flex-col">
      <nav className="sticky top-0 z-20 border-b bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between p-4">
          <div className="mx-auto flex w-full max-w-7xl items-center gap-4">
            <h2 className="text-lg font-semibold">
              <Link href="/docs">
                <ZendoLogo />
              </Link>
            </h2>
            <Link
              title="homepage"
              href="/"
              className="text-sm font-medium text-slate-800 hover:text-orange-500"
            >
              Home
            </Link>
          </div>

          <div>
            <Link
              title="GitHub"
              target="_blank"
              href="https://github.com/jordienr/zenblog"
              className="text-slate-400 hover:text-slate-600"
            >
              <BsGithub size="24" />
            </Link>
          </div>
        </div>
      </nav>
      <div className="mx-auto flex w-full max-w-7xl">
        <aside className="sticky top-14 h-full min-w-[240px] flex-col overflow-y-auto px-4">
          <SidebarTitle>Docs</SidebarTitle>
          <SidebarLink href="/docs/getting-started">
            Getting Started
          </SidebarLink>

          <SidebarTitle>API</SidebarTitle>
          {endpoints.map((endpoint) => (
            <SidebarLink key={endpoint.id} href={`/docs/api/${endpoint.id}`}>
              {endpoint.title}
            </SidebarLink>
          ))}
        </aside>

        <main className="h-full max-w-3xl flex-1 space-y-4 pb-16">
          {children}
        </main>
      </div>
      <footer className="border-t p-8 text-center text-sm text-slate-400">
        <p>Now go ship something cool</p>
      </footer>
    </div>
  );
}

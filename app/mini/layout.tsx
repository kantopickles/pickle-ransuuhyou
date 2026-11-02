import LineMiniAppProvider from "../components/LineMiniAppProvider";

export default function MiniLayout({ children }: { children: React.ReactNode }) {
  return <LineMiniAppProvider>{children}</LineMiniAppProvider>;
}

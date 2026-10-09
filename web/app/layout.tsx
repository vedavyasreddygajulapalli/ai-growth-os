import type { ReactNode } from "react";
export const metadata = {
  title: "AI Growth OS · Growth workspace",
  description: "Your connected growth workspace",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}

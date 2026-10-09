"use client";
import Script from "next/script";
import { useState } from "react";
export default function Page() {
  const [ready, setReady] = useState(false);
  return (
    <>
      <div id="app" />
      <div id="overlay" />
      <div id="toast" role="status" />
      <Script
        src="/runtime-config.js"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      {ready && (
        <Script
          src="/app.js"
          strategy="afterInteractive"
          onReady={() => {
            const s = document.createElement("script");
            s.src = "/foundation.js";
            s.id = "foundation-script";
            if (!document.getElementById(s.id)) document.body.appendChild(s);
          }}
        />
      )}
    </>
  );
}

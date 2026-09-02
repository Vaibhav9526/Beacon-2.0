import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./field-console.css";

export const metadata: Metadata = { title: "BEACON Command Centre", description: "Human-governed crisis intelligence" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{__html: `document.body.insertBefore(document.createComment('THESIS: BEACON is an Indian public-infrastructure field console. OWN-WORLD: charcoal control bands, mineral-white work surfaces, cyan live signals, safety yellow attention, red emergency. STORY: locate, verify, communicate, respond. FIRST VIEWPORT: stable map, live incident rail, focused case file. FORM: transit wayfinding meets survey field notes. FINISH: every visible state is operational and verified.'), document.body.firstChild);`}} />
        {children}
      </body>
    </html>
  );
}

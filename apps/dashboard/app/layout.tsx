import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = { title: "BEACON Command Centre", description: "Human-governed crisis intelligence" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{__html: `document.body.insertBefore(document.createComment('THESIS: BEACON is a lighthouse watch desk, not a generic KPI dashboard. OWN-WORLD: warm paper, navy rails, teal signals. STORY: inspect, decide, dispatch. FIRST VIEWPORT: map, priority rail, evidence workspace. FORM: grounded candidate 4, seed 58a818e3. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance'), document.body.firstChild);`}} />
        {/*
        THESIS: BEACON is a lighthouse watch desk, not a generic KPI dashboard.
        OWN-WORLD: Warm paper surfaces, navy instrument rails, teal live signals, amber/red only for risk.
        STORY: See the operating picture, inspect evidence, make a human decision, and dispatch help.
        FIRST VIEWPORT: Full-height map, compact left rail, priority incident strip, and one focused evidence workspace.
        FORM: Lighthouse watchkeeping console, grounded candidate 4, seed 58a818e3.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
        */}
        {children}
      </body>
    </html>
  );
}

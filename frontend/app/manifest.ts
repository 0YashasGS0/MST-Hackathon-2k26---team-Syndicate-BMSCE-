import type { MetadataRoute } from "next";

// Makes the site installable as a phone app ("Add to Home screen").
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sakshi",
    short_name: "Sakshi",
    description: "Pay for work safely. Your money is held until the job is done.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f7f8",
    theme_color: "#047857",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    ],
  };
}

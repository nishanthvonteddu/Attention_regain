import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Attention Regain",
    short_name: "Attention",
    description:
      "A study feed that turns your source material into quick, grounded cards.",
    start_url: "/",
    display: "standalone",
    background_color: "#16130f",
    theme_color: "#16130f",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}

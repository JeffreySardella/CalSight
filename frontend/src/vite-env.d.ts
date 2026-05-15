/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module "@fontsource-variable/public-sans";
declare module "@fontsource-variable/inter";
declare module "topojson-specification" {
  export interface Topology {
    type: "Topology";
    objects: Record<string, GeometryCollection>;
    arcs: number[][][];
    [key: string]: unknown;
  }
  export interface GeometryCollection {
    type: "GeometryCollection";
    geometries: unknown[];
  }
}

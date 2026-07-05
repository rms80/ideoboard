import { describe } from "./handlers";

// Vercel Edge function — thin wrapper over the framework-agnostic handler.
export const config = { runtime: "edge" };

export default function handler(req: Request): Promise<Response> {
  return describe(req);
}

import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
export function validToken(value: unknown): boolean {
  const expected = process.env.LOCAL_API_TOKEN ?? "";
  if (expected.length < 32 || typeof value !== "string") return false;
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function allowedOrigins(): string[] {
  return [
    ...new Set(
      [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        ...(process.env.WEB_ORIGIN ?? "").split(","),
      ].filter(Boolean),
    ),
  ];
}
export class LocalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest().headers.authorization;
    if (
      typeof header !== "string" ||
      !header.startsWith("Bearer ") ||
      !validToken(header.slice(7))
    )
      throw new UnauthorizedException("กรุณาตั้งค่า Local API token");
    return true;
  }
}

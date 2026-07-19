import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "admitly_session";
const secretValue = process.env.AUTH_SECRET;

function secret() {
  if (!secretValue || secretValue.length < 32) throw new Error("AUTH_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secretValue);
}

export type SessionPayload = {
  userId: string;
  email: string;
  name: string;
  role: "super_admin" | "admin" | "manager" | "counsellor" | "receptionist";
};

export async function createSessionToken(user: SessionPayload) {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(secret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
  return payload as unknown as SessionPayload;
}

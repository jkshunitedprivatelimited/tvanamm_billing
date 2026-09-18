import { Socket } from 'node:net';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { currentOperator } from '@/server/auth';
import { jsonError } from '@/server/http';

// A browser can't open a raw TCP socket (no such web API, by design), and
// WiFi thermal printers speak raw ESC/POS over a plain socket — almost
// always port 9100 — rather than HTTP. This route runs on the till's own
// Node server, on the same LAN as the printer, and is the one piece of this
// feature that has to happen server-side.
const printRequestSchema = z.object({
  ip: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Enter the printer’s IPv4 address'),
  port: z.int().min(1).max(65535).default(9100),
  dataBase64: z.string().min(1).max(200_000),
});

// ESC/POS, IPP and LPR/LPD are the only protocols a thermal or label printer
// on this LAN speaks over raw TCP. Restricting to these ports means an
// operator can't repurpose this route to talk to an arbitrary local service
// (a database, an internal admin panel, etc).
const ALLOWED_PORTS = new Set([9100, 9101, 9102, 631, 515]);

// Printers live on the shop's private LAN. Refusing anything outside
// RFC1918 space blocks SSRF to the public internet, loopback, and
// link-local addresses (169.254.169.254 is the cloud metadata endpoint on
// AWS/GCP/Azure — a frequent SSRF target).
function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a = -1, b = -1] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

const CONNECT_TIMEOUT_MS = 4000;

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

    const { ip, port, dataBase64 } = printRequestSchema.parse(await request.json());
    if (!isPrivateIPv4(ip)) {
      return NextResponse.json(
        {
          error:
            'The printer address must be on the local network (10.x, 172.16-31.x or 192.168.x).',
        },
        { status: 400 },
      );
    }
    if (!ALLOWED_PORTS.has(port)) {
      return NextResponse.json(
        { error: `Port ${String(port)} isn’t a supported printer port.` },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(dataBase64, 'base64');

    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) reject(err);
        else resolve();
      };
      socket.setTimeout(CONNECT_TIMEOUT_MS);
      socket.once('timeout', () => finish(new Error('Timed out reaching the printer.')));
      socket.once('error', (err) => finish(new Error(err.message)));
      socket.connect(port, ip, () => {
        socket.write(bytes, (err) => {
          if (err) finish(new Error(err.message));
          else finish();
        });
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

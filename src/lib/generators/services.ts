/**
 * FW Migrate - AI-Powered Firewall Migration Platform
 * Copyright (c) 2026 Nick Falshaw
 * SPDX-License-Identifier: MIT
 *
 * Vendor-neutral service resolution.
 *
 * Every parser keeps the source vendor's own service tokens on the rule
 * ("application-default", "HTTPS", "junos-https", "tcp/443", "tcp-8443", "ALL",
 * "any", ...). Generators must never copy those tokens into another vendor's
 * syntax. They resolve them here into protocol/port specs first, and each
 * generator then picks its own predefined service name or emits a custom one.
 */

import type { NormalizedObject, NormalizedRule } from "../parsers/types";

export type Proto = "tcp" | "udp" | "icmp";

export interface ServiceSpec {
  proto: Proto;
  /** "443", "3000-3010" (tcp/udp only) */
  ports?: string;
  /** ICMP type, e.g. 8 = echo-request. Undefined = all ICMP. */
  icmpType?: number;
}

/** Predefined service names per target vendor (null = no safe predefined name). */
export interface VendorServiceNames {
  fortinet: string | null;
  junos: string | null;
  checkpoint: string | null;
  panos: string | null;
}

export interface CatalogEntry {
  key: string;
  specs: ServiceSpec[];
  names: VendorServiceNames;
}

/**
 * Well-known services and the predefined objects that exist out of the box on
 * each target. Only names that ship as defaults are listed; anything else is
 * emitted as a custom service by the generator.
 */
export const SERVICE_CATALOG: Record<string, CatalogEntry> = {
  http: {
    key: "http",
    specs: [{ proto: "tcp", ports: "80" }],
    names: { fortinet: "HTTP", junos: "junos-http", checkpoint: "http", panos: "service-http" },
  },
  https: {
    key: "https",
    specs: [{ proto: "tcp", ports: "443" }],
    names: { fortinet: "HTTPS", junos: "junos-https", checkpoint: "https", panos: "service-https" },
  },
  dns: {
    key: "dns",
    specs: [
      { proto: "udp", ports: "53" },
      { proto: "tcp", ports: "53" },
    ],
    names: { fortinet: "DNS", junos: null, checkpoint: null, panos: null },
  },
  "dns-udp": {
    key: "dns-udp",
    specs: [{ proto: "udp", ports: "53" }],
    names: { fortinet: null, junos: "junos-dns-udp", checkpoint: "domain-udp", panos: null },
  },
  "dns-tcp": {
    key: "dns-tcp",
    specs: [{ proto: "tcp", ports: "53" }],
    names: { fortinet: null, junos: "junos-dns-tcp", checkpoint: "domain-tcp", panos: null },
  },
  ssh: {
    key: "ssh",
    specs: [{ proto: "tcp", ports: "22" }],
    names: { fortinet: "SSH", junos: "junos-ssh", checkpoint: "ssh", panos: null },
  },
  telnet: {
    key: "telnet",
    specs: [{ proto: "tcp", ports: "23" }],
    names: { fortinet: "TELNET", junos: "junos-telnet", checkpoint: "telnet", panos: null },
  },
  ftp: {
    key: "ftp",
    specs: [{ proto: "tcp", ports: "21" }],
    names: { fortinet: "FTP", junos: "junos-ftp", checkpoint: "ftp", panos: null },
  },
  smtp: {
    key: "smtp",
    specs: [{ proto: "tcp", ports: "25" }],
    names: { fortinet: "SMTP", junos: "junos-smtp", checkpoint: "smtp", panos: null },
  },
  smtps: {
    key: "smtps",
    specs: [{ proto: "tcp", ports: "465" }],
    names: { fortinet: "SMTPS", junos: null, checkpoint: null, panos: null },
  },
  imaps: {
    key: "imaps",
    specs: [{ proto: "tcp", ports: "993" }],
    names: { fortinet: "IMAPS", junos: null, checkpoint: null, panos: null },
  },
  pop3s: {
    key: "pop3s",
    specs: [{ proto: "tcp", ports: "995" }],
    names: { fortinet: "POP3S", junos: null, checkpoint: null, panos: null },
  },
  pop3: {
    key: "pop3",
    specs: [{ proto: "tcp", ports: "110" }],
    names: { fortinet: "POP3", junos: "junos-pop3", checkpoint: "pop-3", panos: null },
  },
  imap: {
    key: "imap",
    specs: [{ proto: "tcp", ports: "143" }],
    names: { fortinet: "IMAP", junos: "junos-imap", checkpoint: "imap", panos: null },
  },
  ntp: {
    key: "ntp",
    specs: [{ proto: "udp", ports: "123" }],
    names: { fortinet: "NTP", junos: "junos-ntp", checkpoint: "ntp-udp", panos: null },
  },
  snmp: {
    key: "snmp",
    specs: [{ proto: "udp", ports: "161-162" }],
    names: { fortinet: "SNMP", junos: null, checkpoint: null, panos: null },
  },
  syslog: {
    key: "syslog",
    specs: [{ proto: "udp", ports: "514" }],
    names: { fortinet: "SYSLOG", junos: "junos-syslog", checkpoint: "syslog", panos: null },
  },
  ldap: {
    key: "ldap",
    specs: [{ proto: "tcp", ports: "389" }],
    names: { fortinet: "LDAP", junos: "junos-ldap", checkpoint: "ldap", panos: null },
  },
  ldaps: {
    key: "ldaps",
    specs: [{ proto: "tcp", ports: "636" }],
    names: { fortinet: null, junos: null, checkpoint: "ldap-ssl", panos: null },
  },
  rdp: {
    key: "rdp",
    specs: [{ proto: "tcp", ports: "3389" }],
    names: { fortinet: "RDP", junos: null, checkpoint: "Remote_Desktop_Protocol", panos: null },
  },
  tftp: {
    key: "tftp",
    specs: [{ proto: "udp", ports: "69" }],
    names: { fortinet: "TFTP", junos: "junos-tftp", checkpoint: "tftp", panos: null },
  },
  mssql: {
    key: "mssql",
    specs: [{ proto: "tcp", ports: "1433" }],
    names: { fortinet: null, junos: null, checkpoint: "MS-SQL-Server", panos: null },
  },
  mysql: {
    key: "mysql",
    specs: [{ proto: "tcp", ports: "3306" }],
    names: { fortinet: "MYSQL", junos: null, checkpoint: null, panos: null },
  },
  smb: {
    key: "smb",
    specs: [{ proto: "tcp", ports: "445" }],
    names: { fortinet: "SMB", junos: null, checkpoint: "microsoft-ds", panos: null },
  },
  kerberos: {
    key: "kerberos",
    specs: [
      { proto: "tcp", ports: "88" },
      { proto: "udp", ports: "88" },
    ],
    names: { fortinet: "KERBEROS", junos: null, checkpoint: null, panos: null },
  },
  bgp: {
    key: "bgp",
    specs: [{ proto: "tcp", ports: "179" }],
    names: { fortinet: "BGP", junos: "junos-bgp", checkpoint: "bgp", panos: null },
  },
  ping: {
    key: "ping",
    specs: [{ proto: "icmp", icmpType: 8 }],
    names: { fortinet: "PING", junos: "junos-ping", checkpoint: "echo-request", panos: null },
  },
  icmp: {
    key: "icmp",
    specs: [{ proto: "icmp" }],
    names: { fortinet: "ALL_ICMP", junos: "junos-icmp-all", checkpoint: "icmp-proto", panos: null },
  },
  "all-tcp": {
    key: "all-tcp",
    specs: [{ proto: "tcp", ports: "1-65535" }],
    names: { fortinet: "ALL_TCP", junos: null, checkpoint: null, panos: null },
  },
  "all-udp": {
    key: "all-udp",
    specs: [{ proto: "udp", ports: "1-65535" }],
    names: { fortinet: "ALL_UDP", junos: null, checkpoint: null, panos: null },
  },
};

/**
 * PAN-OS App-IDs -> the ports that `application-default` resolves to.
 * Covers the common infrastructure applications; anything not listed is
 * reported as unmapped and flagged for review instead of guessed.
 */
export const APP_ID_SERVICES: Record<string, string[]> = {
  ssl: ["https"],
  "web-browsing": ["http"],
  dns: ["dns"],
  "dns-base": ["dns"],
  ssh: ["ssh"],
  telnet: ["telnet"],
  ftp: ["ftp"],
  smtp: ["smtp"],
  "smtp-base": ["smtp"],
  pop3: ["pop3"],
  imap: ["imap"],
  ntp: ["ntp"],
  "ntp-base": ["ntp"],
  snmp: ["snmp"],
  "snmp-base": ["snmp"],
  snmpv1: ["snmp"],
  snmpv2: ["snmp"],
  snmpv3: ["snmp"],
  syslog: ["syslog"],
  ldap: ["ldap"],
  "ms-rdp": ["rdp"],
  rdp: ["rdp"],
  tftp: ["tftp"],
  "mssql-db": ["mssql"],
  mysql: ["mysql"],
  "ms-ds-smb": ["smb"],
  "ms-ds-smb-base": ["smb"],
  kerberos: ["kerberos"],
  bgp: ["bgp"],
  ping: ["ping"],
  icmp: ["icmp"],
};

/** Cisco ASA port keywords -> numbers */
const ASA_PORT_NAMES: Record<string, string> = {
  www: "80",
  http: "80",
  https: "443",
  domain: "53",
  ssh: "22",
  telnet: "23",
  ftp: "21",
  "ftp-data": "20",
  smtp: "25",
  pop3: "110",
  imap4: "143",
  ntp: "123",
  snmp: "161",
  snmptrap: "162",
  syslog: "514",
  ldap: "389",
  ldaps: "636",
  tftp: "69",
  sqlnet: "1521",
  kerberos: "88",
  bgp: "179",
  "netbios-ssn": "139",
  "netbios-ns": "137",
  "netbios-dgm": "138",
  isakmp: "500",
  radius: "1645",
  "radius-acct": "1646",
  sip: "5060",
  rtsp: "554",
  lpd: "515",
  nntp: "119",
  echo: "7",
};

/** Lower-cased predefined names of every vendor -> catalog key */
const ALIASES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const entry of Object.values(SERVICE_CATALOG)) {
    for (const n of Object.values(entry.names)) {
      if (n) m[n.toLowerCase()] = entry.key;
    }
  }
  // Common extra spellings seen in source configs
  Object.assign(m, {
    "junos-dns": "dns",
    "junos-icmp-ping": "ping",
    "junos-ms-sql": "mssql",
    "junos-smb": "smb",
    "junos-rdp": "rdp",
    "junos-snmp-agentx": "snmp",
    domain: "dns",
    "domain-udp": "dns-udp",
    "domain-tcp": "dns-tcp",
    ntp: "ntp",
    "echo-request": "ping",
    icmp: "icmp",
    ping: "ping",
    "all_icmp": "icmp",
  });
  return m;
})();

const ANY_TOKENS = new Set(["any", "all", "any4", "any-service"]);

export function isAnyToken(token: string | undefined): boolean {
  return !token || ANY_TOKENS.has(token.toLowerCase());
}

export interface ResolvedService {
  /** Name to use when the target needs a custom object */
  label: string;
  specs: ServiceSpec[];
  /** Catalog key when the service is a well-known one (lets targets use predefined names) */
  key?: string;
  /** Where it came from */
  origin: "catalog" | "object" | "literal" | "app-id";
}

export interface ServiceResolution {
  any: boolean;
  services: ResolvedService[];
  /** App-IDs on the source rule, "any" removed */
  applications: string[];
  fromApplicationDefault: boolean;
  unmappedApps: string[];
  unresolvedServices: string[];
  /** Nothing usable could be resolved: the generator must not emit a live rule */
  unresolvable: boolean;
}

export function specLabel(spec: ServiceSpec): string {
  if (spec.proto === "icmp")
    return spec.icmpType === undefined ? "icmp" : `icmp-${spec.icmpType}`;
  return `${spec.proto}-${spec.ports}`;
}

/** Parse "tcp/443", "udp/53-55", "tcp/www", "tcp/80,443" */
export function parseLiteralService(token: string): ServiceSpec[] | null {
  const m = token.match(/^(tcp|udp)\/(.+)$/i);
  if (m) {
    const proto = m[1].toLowerCase() as Proto;
    const out: ServiceSpec[] = [];
    for (const part of m[2].split(",")) {
      const ports = normalisePorts(part.trim());
      if (!ports) return null;
      out.push({ proto, ports });
    }
    return out;
  }
  const lower = token.toLowerCase();
  if (lower === "icmp") return [{ proto: "icmp" }];
  if (lower === "tcp") return [{ proto: "tcp", ports: "1-65535" }];
  if (lower === "udp") return [{ proto: "udp", ports: "1-65535" }];
  return null;
}

function normalisePorts(p: string): string | null {
  const named = ASA_PORT_NAMES[p.toLowerCase()];
  if (named) return named;
  if (/^\d{1,5}$/.test(p)) return p;
  const r = p.match(/^(\w[\w-]*?)-(\w+)$/);
  if (r) {
    const a = ASA_PORT_NAMES[r[1].toLowerCase()] ?? r[1];
    const b = ASA_PORT_NAMES[r[2].toLowerCase()] ?? r[2];
    if (/^\d{1,5}$/.test(a) && /^\d{1,5}$/.test(b)) return `${a}-${b}`;
  }
  return null;
}

function catalogService(key: string, origin: ResolvedService["origin"]): ResolvedService {
  const e = SERVICE_CATALOG[key];
  return { label: key, specs: e.specs, key, origin };
}

/** Match a spec set back to a catalog key (so tcp/443 can use HTTPS on FortiOS) */
export function catalogKeyForSpecs(specs: ServiceSpec[]): string | undefined {
  const sig = (s: ServiceSpec[]) =>
    s
      .map((x) => `${x.proto}/${x.ports ?? ""}/${x.icmpType ?? ""}`)
      .sort()
      .join(",");
  const target = sig(specs);
  for (const e of Object.values(SERVICE_CATALOG)) {
    if (sig(e.specs) === target) return e.key;
  }
  return undefined;
}

function resolveNamedObject(
  name: string,
  objects: Map<string, NormalizedObject>,
  depth = 0,
): ResolvedService[] | null {
  const obj = objects.get(name);
  if (!obj || depth > 8) return null;
  if (obj.objectType === "service") {
    const specs: ServiceSpec[] = [];
    for (const m of obj.members) {
      const s = parseLiteralService(m);
      if (!s) return null;
      specs.push(...s);
    }
    const key = catalogKeyForSpecs(specs);
    const lower = name.toLowerCase();
    // A source object that is just the vendor's copy of a well-known service
    // ("https" = tcp/443 on Check Point) maps to the target's predefined one.
    if (key && (ALIASES[lower] === key || key.startsWith(lower)))
      return [catalogService(key, "catalog")];
    return [{ label: name, specs, origin: "object", key }];
  }
  if (obj.objectType === "service-group") {
    const out: ResolvedService[] = [];
    const groupProto = (obj.rawVendorData?.protocol as string | undefined)?.toLowerCase();
    for (const m of obj.members) {
      const nested = resolveNamedObject(m, objects, depth + 1);
      if (nested) {
        out.push(...nested);
        continue;
      }
      const literal =
        parseLiteralService(m) ??
        (groupProto === "tcp" || groupProto === "udp"
          ? parseLiteralService(`${groupProto}/${m}`)
          : groupProto === "tcp-udp"
            ? [
                ...(parseLiteralService(`tcp/${m}`) ?? []),
                ...(parseLiteralService(`udp/${m}`) ?? []),
              ]
            : null);
      if (literal && literal.length) {
        out.push({
          label: literal.map(specLabel).join("_"),
          specs: literal,
          origin: "literal",
          key: catalogKeyForSpecs(literal),
        });
        continue;
      }
      const alias = ALIASES[m.toLowerCase()];
      if (alias) {
        out.push(catalogService(alias, "catalog"));
        continue;
      }
      return null;
    }
    return out;
  }
  return null;
}

/**
 * Resolve a normalised rule's services (and, for PAN-OS sources, App-IDs with
 * application-default) into vendor-neutral protocol/port specs.
 */
export function resolveServices(
  rule: NormalizedRule,
  objects: Map<string, NormalizedObject>,
): ServiceResolution {
  const rawApps = (rule.rawVendorData?.application as string[] | undefined) ?? [];
  const applications = rawApps.filter((a) => !isAnyToken(a));
  const res: ServiceResolution = {
    any: false,
    services: [],
    applications,
    fromApplicationDefault: false,
    unmappedApps: [],
    unresolvedServices: [],
    unresolvable: false,
  };

  const tokens = rule.services.length ? rule.services : ["any"];
  const seen = new Set<string>();
  const push = (s: ResolvedService) => {
    const sig = `${s.label}|${s.specs.map(specLabel).join(",")}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      res.services.push(s);
    }
  };

  for (const token of tokens) {
    if (isAnyToken(token) || token.toLowerCase() === "ip") {
      res.any = true;
      continue;
    }
    if (token === "application-default") {
      res.fromApplicationDefault = true;
      if (applications.length === 0) {
        // application any + application-default = any port
        res.any = true;
        continue;
      }
      for (const app of applications) {
        const keys = APP_ID_SERVICES[app.toLowerCase()];
        if (!keys) {
          res.unmappedApps.push(app);
          continue;
        }
        for (const k of keys) push({ ...catalogService(k, "app-id") });
      }
      continue;
    }
    const literal = parseLiteralService(token);
    if (literal) {
      const key = catalogKeyForSpecs(literal);
      push({ label: literal.map(specLabel).join("_"), specs: literal, origin: "literal", key });
      continue;
    }
    const named = resolveNamedObject(token, objects);
    if (named) {
      named.forEach(push);
      continue;
    }
    const alias = ALIASES[token.toLowerCase()];
    if (alias) {
      push(catalogService(alias, "catalog"));
      continue;
    }
    res.unresolvedServices.push(token);
  }

  if (res.any) {
    res.services = [];
  } else if (res.services.length === 0) {
    res.unresolvable = true;
  }
  return res;
}

/**
 * Predefined target names for a catalog service. Some vendors split a service
 * that another vendor ships as one object (DNS = udp+tcp/53).
 */
export function predefinedNames(
  key: string | undefined,
  vendor: keyof VendorServiceNames,
): string[] | null {
  if (!key) return null;
  if (key === "dns") {
    if (vendor === "junos") return ["junos-dns-udp", "junos-dns-tcp"];
    if (vendor === "checkpoint") return ["domain-udp", "domain-tcp"];
  }
  const n = SERVICE_CATALOG[key]?.names[vendor];
  return n ? [n] : null;
}

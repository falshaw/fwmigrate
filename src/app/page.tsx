import Link from "next/link";

const vendors = [
  { name: "Palo Alto", icon: "🔥" },
  { name: "Cisco ASA", icon: "🌐" },
  { name: "Fortinet", icon: "🛡️" },
  { name: "Check Point", icon: "✅" },
  { name: "Juniper SRX", icon: "🌿" },
];

const steps = [
  {
    num: "01",
    title: "Import",
    desc: "Paste or upload your source firewall config",
  },
  {
    num: "02",
    title: "Analyze",
    desc: "AI detects shadows, conflicts, and overly-permissive rules",
  },
  {
    num: "03",
    title: "Translate",
    desc: "Automated translation to target vendor syntax",
  },
  {
    num: "04",
    title: "Review",
    desc: "Approve each rule with AI explanations",
  },
  {
    num: "05",
    title: "Export",
    desc: "Download target config + migration plan",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1e36] to-[#132743]">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-orange-500">FW Migrate</span>
          <span className="text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">
            by Nick Falshaw
          </span>
        </div>
        <div className="flex gap-4">
          <Link
            href="/login"
            className="text-gray-300 hover:text-white transition"
          >
            Login
          </Link>
          <Link href="/register" className="btn-brand text-sm">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-8 pt-20 pb-16 text-center">
        <h1 className="text-5xl md:text-6xl font-bold mb-6">
          <span className="text-white">Migrate Firewalls</span>{" "}
          <span className="bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
            with AI
          </span>
        </h1>
        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          Paste your source config. Get a fully translated target config with
          analysis, explanations, and a migration plan.
        </p>
        <Link
          href="/register"
          className="btn-brand text-lg px-8 py-3 inline-block"
        >
          Start Free Migration
        </Link>
      </section>

      {/* Vendor bar */}
      <section className="max-w-4xl mx-auto px-8 pb-16">
        <div className="flex justify-center gap-6 flex-wrap">
          {vendors.map((v) => (
            <div
              key={v.name}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10"
            >
              <span>{v.icon}</span>
              <span className="text-sm text-gray-300">{v.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="max-w-5xl mx-auto px-8 pb-20">
        <h2 className="text-3xl font-bold text-center mb-12 text-white">
          How It Works
        </h2>
        <div className="grid md:grid-cols-5 gap-6">
          {steps.map((step) => (
            <div key={step.num} className="text-center">
              <div className="text-4xl font-bold text-orange-500/30 mb-2">
                {step.num}
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">
                {step.title}
              </h3>
              <p className="text-sm text-gray-400">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-500">
        <p>
          &copy; {new Date().getFullYear()} Nick Falshaw. MIT License.
        </p>
      </footer>
    </div>
  );
}

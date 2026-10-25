import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Cpu, Layers3, MoveUpRight, Radio, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/Brand";
import { CATALOG } from "@/data/catalog";
import benchmark from "../../../data/bench-results.json";
import { RackArtwork } from "./RackArtwork";
import { RackPreview } from "./RackPreview";
import styles from "./landing.module.css";

const trainingScenarios = benchmark.trainSeeds[1] - benchmark.trainSeeds[0] + 1;

const method = [
  { icon: Layers3, number: "01", title: "Translate the brief", text: "RequirementsAgent shapes the constraints. RackArchitect places real catalog equipment, one unit at a time." },
  { icon: ShieldCheck, number: "02", title: "Prove the plan", text: "Code checks fit, power, feeds, ports and cost. RepairAgent proposes changes; the verifier decides what to keep." },
  { icon: Radio, number: "03", title: "Learn from the outcome", text: "Mubit groups stable agent tasks and evaluates adapters. Verifier outcomes show which proposals improved a real rack." },
];

export function LandingPage() {
  return <main className={styles.page}>
    <div className={styles.darkTop}>
      <header className={styles.nav}>
        <Brand />
        <nav aria-label="Main navigation"><a href="#system">The system</a><a href="#method">How it works</a><a href="#evidence">Evidence</a></nav>
        <Link href="/dashboard" className={styles.navAction}>Open workspace <ArrowUpRight size={17} /></Link>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span className={styles.signalDot} /> AN OPERATING SYSTEM FOR RACK DESIGN</p>
          <h1 id="hero-title">Build racks<br />that <em>hold up.</em></h1>
          <p className={styles.heroLead}>From a rough infrastructure brief to a plan you can see, challenge and trust. Agents create the possibilities. Engineering rules keep them honest.</p>
          <div className={styles.heroActions}>
            <Link href="/dashboard" className={styles.primaryAction}>Enter RackOS <ArrowUpRight size={20} /></Link>
            <a href="#system" className={styles.textAction}>Explore the system <ArrowDown size={17} /></a>
          </div>
          <p className={styles.heroAside}>DESIGN → VERIFY → REFINE</p>
        </div>
        <div className={styles.heroArt}><RackArtwork /></div>
      </section>
      <div className={styles.heroEnd}><span>ENGINEERED FOR THE REAL WORLD</span><span>SCROLL TO EXPLORE <ArrowDown size={13} /></span></div>
    </div>

    <section className={styles.proofStrip} id="evidence" aria-label="RackOS at a glance">
      <div className={styles.proofInner}>
        <div><strong>{CATALOG.length}</strong><span>real equipment models</span></div>
        <div><strong>14</strong><span>deterministic check types</span></div>
        <div><strong>{trainingScenarios}</strong><span>local training scenarios</span></div>
        <p>Measured in this project. Adapter performance is reported separately once Mubit has a passing evaluation.</p>
      </div>
    </section>

    <section className={styles.system} id="system" aria-labelledby="system-title">
      <div className={styles.systemInner}>
        <div className={styles.systemCopy}>
          <p className={styles.kicker}>01 / THE IDEA</p>
          <h2 id="system-title">A rack is a system.<br /><em>See the whole thing.</em></h2>
          <p className={styles.sectionLead}>A parts list cannot tell you whether the devices fit, a feed survives failure, or a new budget breaks the design. RackOS makes those dependencies visible while there is still time to change them.</p>
          <div className={styles.reasonList}>
            <div><span>01</span><div><strong>Physical truth</strong><p>Rack units, depth, weight and placement are checked against the actual design.</p></div></div>
            <div><span>02</span><div><strong>Operational resilience</strong><p>Power, A/B feeds, outlets and ports are tested together.</p></div></div>
            <div><span>03</span><div><strong>Change without guesswork</strong><p>Shift a constraint and see exactly what fails before you commit a repair.</p></div></div>
          </div>
        </div>
        <div className={styles.systemPreview}>
          <div className={styles.previewHeading}><span>LIVE FIELD TEST</span><span>TRY THE POWER CUT ↘</span></div>
          <RackPreview />
        </div>
      </div>
    </section>

    <section className={styles.method} id="method" aria-labelledby="method-title">
      <div className={styles.methodInner}>
        <div className={styles.methodHeading}>
          <div><p className={styles.kicker}>02 / THE METHOD</p><h2 id="method-title">Intelligence with<br /><em>an engineering spine.</em></h2></div>
          <p>Four specialist agents share the work. The validator owns the final decision. People stay in control of the brief, the edits and the tradeoffs.</p>
        </div>
        <div className={styles.methodGrid}>
          {method.map(({ icon: Icon, number, title, text }) => <article key={number}>
            <div className={styles.methodTop}><span>{number} / 03</span><Icon size={22} strokeWidth={1.6} /></div>
            <h3>{title}</h3><p>{text}</p>
          </article>)}
        </div>
        <div className={styles.methodBottom}>
          <div className={styles.audience}><span>MADE FOR</span><strong>Data center teams</strong><span>/</span><strong>Infrastructure architects</strong><span>/</span><strong>IT and procurement</strong></div>
          <div className={styles.mubitNote}><Cpu size={19} /><p><strong>Mubit is the learning layer.</strong> Agent calls use its gateway and stable task identities. The last console snapshot had no live adapter, so RackOS shows local verification separately from adapter claims.</p><Link href="/lab" aria-label="Explore model evidence"><MoveUpRight size={18} /></Link></div>
        </div>
      </div>
    </section>

    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div><p className={styles.kicker}>READY TO PUT A DESIGN TO THE TEST?</p><h2>Make space for<br /><em>better decisions.</em></h2></div>
        <Link href="/dashboard" className={styles.footerAction}>Open your workspace <ArrowUpRight size={20} /></Link>
      </div>
      <div className={styles.footerBase}><Brand compact /><span><Check size={14} /> AI PROPOSES. CODE DECIDES.</span><div><Link href="/lab">Model lab</Link><a href="#system">Back to top <ArrowRight size={14} /></a></div></div>
    </footer>
  </main>;
}

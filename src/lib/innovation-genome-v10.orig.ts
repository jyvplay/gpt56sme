/**
 * innovation-genome-v10.ts — Creative Tree of Life plane.
 * Additive over V1-V9. Offline-first. No model/web/solver dependency.
 * Semantics preserved: novelty = workspace-local dissimilarity only; generated
 * content = unverified proposal; rejected branches preserved as compost; human
 * authorship/edits distinguishable from generated content.
 */

import { seedToGenome } from "@/lib/innovation-genome-engine";
import { classifyPersonaExtended, selectPathExtended } from "@/lib/innovation-genome-engine-v2";
import { deriveSeed, sha256Text, canonicalJson, utcNow } from "@/lib/innovation-genome-v3";
import { V9CompliancePlaneStore } from "@/lib/innovation-genome-v9";

export const V10_SCHEMA_VERSION = 1;
export const V10_PROTOCOL_VERSION = "10.0-alpha-rc1";

export type CreativeMode = "idea" | "theory" | "product" | "code" | "research" | "story";
export type NodeKind = "root" | "idea" | "question" | "analogy" | "assumption" | "experiment" | "synthesis" | "note";
export type LifeStage = "seed" | "sprout" | "branch" | "bloom" | "fruit" | "compost";
export type NodeStatus = "active" | "favorite" | "parked" | "rejected" | "merged" | "archived";
export type EdgeRelation = "grows_from" | "refines" | "combines" | "asks" | "tests" | "supports" | "challenges" | "analogy_to" | "recycles" | "depends_on";
export type ConfirmationVerdict = "confirm" | "reject" | "uncertain";
export type ConfirmationDimension = "overall" | "problem_real" | "value_desirable" | "mechanism_plausible" | "feasible" | "validation_testable" | "differentiated" | "ethical" | "personal_energy";

export interface CreativeBrief {
  challenge: string;
  mode: CreativeMode;
  audience: string[];
  desiredOutcomes: string[];
  constraints: string[];
  resources: string[];
  inspirationDomains: string[];
  avoid: string[];
  axes: Record<string, string[]>;
}

export interface IdeaCard {
  title: string;
  thesis: string;
  beneficiary: string;
  tension: string;
  mechanism: string;
  value: string;
  differentiation: string;
  assumptions: string[];
  risks: string[];
  validation: string[];
  nextAction: string;
  artifacts: string[];
  openQuestions: string[];
  operatorId: string;
  operatorFamily: string;
  mode: CreativeMode;
  morphology: Record<string, string>;
  modeFields: Record<string, unknown>;
  tags: string[];
  epistemicStatus: string;
}

export interface NodeRecord {
  nodeId: string;
  workspaceId: string;
  nodeKind: NodeKind;
  lifeStage: LifeStage;
  status: NodeStatus;
  title: string;
  body: Record<string, unknown> | IdeaCard;
  operatorId: string;
  fingerprint: string;
  localNovelty: number;
  cohesion: number;
  depth: number;
  createdBy: string;
  createdUtc: string;
  updatedUtc: string;
}

export interface RankedIdea {
  node: NodeRecord;
  score: number;
  humanScore: number;
  preferenceScore: number;
  noveltyScore: number;
  cohesionScore: number;
}

export interface TreeHealth {
  nodeCount: number; branchCount: number; bloomCount: number; fruitCount: number; compostCount: number;
  operatorFamilyCount: number; meanLocalNovelty: number; meanCohesion: number; humanTouchRate: number; confirmationCount: number;
}

export interface BurstConfig { count: number; candidateMultiplier: number; maximumSimilarity: number; minimumOperatorFamilies: number; }

export interface OperatorSpec {
  operatorId: string; family: string; name: string; principle: string;
  mechanismTemplate: string; reflectionQuestion: string; validationTemplate: string;
}

export const OPERATORS: OperatorSpec[] = [
  ["subtract","simplification","Radical Subtraction","Remove a step rather than adding another feature."],
  ["invert","power_shift","Role Inversion","Reverse who initiates, owns, approves, or benefits."],
  ["protocol","infrastructure","Protocol Instead of Product","Create an interoperable rule or interface."],
  ["observability","information","Reveal the Hidden State","Make an invisible condition measurable."],
  ["concierge","service","Concierge Before Automation","Deliver the value manually before automating it."],
  ["composable","architecture","Composable Building Blocks","Replace a monolith with reusable pieces."],
  ["local_first","ownership","Local-First Ownership","Move control and memory toward the user."],
  ["collective","collective_intelligence","Collective Intelligence","Aggregate diverse partial judgments."],
  ["counterfactual","simulation","Counterfactual Twin","Test consequences in a safe parallel representation."],
  ["preventive","timing","Move Earlier","Intervene before the problem becomes expensive."],
  ["reversible","risk","Reversible Commitments","Convert one large bet into inspectable reversible steps."],
  ["cross_domain","analogy","Cross-Domain Transfer","Import a mechanism, not superficial vocabulary."],
  ["market","coordination","Coordination Market","Match fragmented needs and underused capacity."],
  ["proof_carrying","trust","Proof-Carrying Output","Make each important result carry its own evidence."],
  ["accessibility","inclusion","Constraint as Design Material","Design first for the hardest access constraint."],
  ["antifragile","resilience","Learn From Failure","Turn each failure into a reusable improvement."],
  ["progressive","interaction","Progressive Disclosure","Give the smallest useful result first."],
  ["ecology","ecology","Mutualistic Ecosystem","Create a loop where participants improve one another."],
  ["ritual","behavior","Ritual and Rhythm","Turn an occasional intention into a repeated practice."],
  ["two_speed","governance","Two-Speed System","Separate rapid exploration from slow irreversible commitment."],
].map(([operatorId, family, name, principle]) => ({
  operatorId, family, name, principle,
  mechanismTemplate: `apply ${name.toLowerCase()} to “{challenge}” for {audience}, using {resource}, under {constraint}, toward {outcome}`,
  reflectionQuestion: `What changes if ${principle.toLowerCase()}`,
  validationTemplate: "Test smallest falsifiable version with one human reviewer and record disconfirming evidence.",
}));

const STOP = new Set("a an and are as at be by for from how in into is it of on or that the their this to use using with without we you your".split(" "));
const DEFAULT_SHAPES = ["a personal tool","a guided service","a reusable protocol","a small-team practice","a shared commons","an ambient layer","a modular platform","a temporary experiment"];
const DEFAULT_HORIZONS = ["at the moment of decision","before the first visible failure","once per working cycle","during onboarding","after every completed attempt","whenever uncertainty rises"];
const DEFAULT_SCALES = ["one person","a pair","a small team","a community","an organization","an ecosystem"];

function tokens(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z0-9_]{3,}/g) ?? []).map(t => t.toLowerCase()).filter(t => !STOP.has(t)));
}
function jaccard(a: Set<string>, b: Set<string>): number { const u = new Set([...a, ...b]); if (!u.size) return 1; let i = 0; for (const x of a) if (b.has(x)) i++; return i / u.size; }
function textOf(card: IdeaCard): string { return canonicalJson(card); }
function fingerprint(card: IdeaCard): string { return sha256Text(canonicalJson({ operator_id: card.operatorId, tokens: [...tokens(textOf(card))].sort(), morphology: card.morphology })); }
function rawFingerprint(body: Record<string, unknown>): string { return sha256Text(canonicalJson(body)); }
function concept(challenge: string): string { return (challenge.match(/[A-Za-z0-9]+/g) ?? []).filter(w => !STOP.has(w.toLowerCase())).slice(0,4).map(w => w[0].toUpperCase()+w.slice(1)).join(" ") || "New Concept"; }
function pick(values: string[], fallback: string, seed: number): string { return values.length ? values[Math.abs(seed) % values.length] : fallback; }

function modeScaffold(mode: CreativeMode, challenge: string, audience: string, outcome: string, mechanism: string): [string[], string, string[], Record<string, unknown>] {
  if (mode === "product") return [["A one-page product concept","A concierge prototype","A five-question interview guide"], "Interview three target users, then deliver value manually to one before building software.", ["What narrow use case is urgent?", "What evidence would cause behavior switch?"], { job_to_be_done: `Help ${audience} make progress on ${challenge}.`, mvp: "Concierge or clickable version containing only load-bearing interaction.", mechanism }];
  if (mode === "code") return [["A behavioral contract","An interface/data model","A vertical executable slice","A failure-oriented test plan"], "Write acceptance test first, then implement one end-to-end path with no hidden dependencies.", ["What state must survive restart?", "Which operation can cause irreversible harm?"], { behavioral_contract: `Given valid input related to ${challenge}, return inspectable result that advances ${outcome}.`, mechanism }];
  if (mode === "research") return [["A falsifiable research question","A hypothesis and alternative","A minimal study protocol","A measurement table"], "Specify smallest study distinguishing hypothesis from baseline.", ["Which result makes hypothesis less likely?", "What confounder creates same observation?"], { research_question: challenge, hypothesis: `Applying mechanism improves ${outcome} for ${audience}.`, mechanism }];
  if (mode === "story") return [["A premise card","A character-pressure map","A world-rule sheet","One opening scene"], "Write scene where protagonist chooses between mechanism benefit and hidden cost.", ["What price makes premise emotionally real?", "How does protagonist misunderstand mechanism?"], { premise: `World where mechanism behind ${challenge} becomes visible.`, protagonist: audience, mechanism }];
  if (mode === "theory") return [["A one-page theory map","A prediction/falsifier table","A scope-condition register"], "Identify cheapest observation separating mechanism from alternative.", ["Which alternative predicts same result?", "Where should effect disappear?"], { phenomenon: challenge, hypothesis: `Outcome may arise because ${mechanism}.` }];
  return [["A concept card","A mechanism diagram","A validation checklist"], "Show concept to one affected person and ask them to change one assumption.", ["What must be true for this to matter?", "What adjacent idea strengthens it?"], { change_model: "Current state -> mechanism -> observable result" }];
}

export class OfflineMorphologicalProvider {
  generate(brief: CreativeBrief, genome: Record<string, number>, seed: number, candidateCount: number, operatorIds: string[] = [], parentContext = ""): IdeaCard[] {
    if (!brief.challenge.trim()) throw new Error("Creative brief challenge cannot be empty");
    const allowed = operatorIds.length ? OPERATORS.filter(o => operatorIds.includes(o.operatorId)) : OPERATORS;
    const cards: IdeaCard[] = [];
    for (let i = 0; i < candidateCount; i++) {
      const op = allowed[Math.abs(deriveSeed(seed, i, "op")) % allowed.length];
      const audience = pick(brief.audience, "the person most affected by the challenge", deriveSeed(seed, i, "aud"));
      const outcome = pick(brief.desiredOutcomes, "a measurable improvement in clarity, agency, or outcome", deriveSeed(seed, i, "out"));
      const constraint = pick(brief.constraints, "limited time, trust, attention, or resources", deriveSeed(seed, i, "con"));
      const resource = pick(brief.resources, "existing knowledge, relationships, and underused capacity", deriveSeed(seed, i, "res"));
      const domain = pick(brief.inspirationDomains, ["ecology","public infrastructure","craft apprenticeship","distributed systems","games","scientific instrumentation","mutual aid","logistics"][Math.abs(deriveSeed(seed,i,"dom"))%8], deriveSeed(seed, i, "dom2"));
      const shape = DEFAULT_SHAPES[Math.abs(deriveSeed(seed,i,"shape")) % DEFAULT_SHAPES.length];
      const horizon = DEFAULT_HORIZONS[Math.abs(deriveSeed(seed,i,"h")) % DEFAULT_HORIZONS.length];
      const scale = DEFAULT_SCALES[Math.abs(deriveSeed(seed,i,"scale")) % DEFAULT_SCALES.length];
      const morphology: Record<string,string> = { audience, outcome, constraint, resource, source_domain: domain, delivery_shape: shape, time_horizon: horizon, scale };
      for (const [axis, opts] of Object.entries(brief.axes)) morphology[axis] = opts[Math.abs(deriveSeed(seed,i,axis)) % opts.length];
      let mechanism = op.mechanismTemplate.replace("{challenge}", brief.challenge).replace("{audience}", audience).replace("{resource}", resource).replace("{constraint}", constraint).replace("{outcome}", outcome);
      if (parentContext) mechanism += `. Preserve useful parent branch: ${parentContext.slice(0,240)}`;
      const [artifacts, nextAction, qs, modeFields] = modeScaffold(brief.mode, brief.challenge, audience, outcome, mechanism);
      cards.push({
        title: `${op.name} · ${concept(brief.challenge)}${i >= allowed.length ? ` · ${shape.replace(/^a |^an /,"")}` : ""}`,
        thesis: `For ${audience}, explore ${shape} that addresses “${brief.challenge.replace(/\.$/,"")}” by attempting to ${mechanism}. Use it ${horizon} at ${scale} scale.`,
        beneficiary: audience,
        tension: `Intended outcome is ${outcome}, but current approaches are constrained by ${constraint}.`,
        mechanism,
        value: `If mechanism works, it should improve ${outcome} while making important trade-offs visible.`,
        differentiation: `Organized around ${op.principle} Tested combination: ${Object.entries(morphology).map(([k,v])=>`${k}=${v}`).join("; ")}.`,
        assumptions: [`${audience} experiences challenge frequently enough to care.`, "Mechanism changes load-bearing part of current situation.", `Design can operate within ${constraint} by using ${resource}.`],
        risks: ["Mechanism may sound coherent without changing behavior.", "Selected audience may not value intended outcome.", "Intervention may move effort or risk to less visible participant."],
        validation: [op.validationTemplate, "Ask human reviewer to identify weakest causal link before implementation.", "Record disconfirming result rather than silently rewriting original claim."],
        nextAction,
        artifacts,
        openQuestions: [op.reflectionQuestion, ...qs],
        operatorId: op.operatorId,
        operatorFamily: op.family,
        mode: brief.mode,
        morphology,
        modeFields,
        tags: [...new Set([op.family, op.operatorId, brief.mode, domain, shape, scale, ...tokens(brief.challenge)])],
        epistemicStatus: "proposal — unverified until a human confirms or tests it",
      });
      void genome;
    }
    return cards;
  }
}

function cohesion(card: IdeaCard, brief: CreativeBrief): number {
  const req = [card.title, card.thesis, card.beneficiary, card.tension, card.mechanism, card.value, card.differentiation, card.nextAction];
  const completeness = req.filter(v => v.trim()).length / req.length;
  const briefTokens = tokens([brief.challenge, ...brief.desiredOutcomes, ...brief.audience].join(" "));
  const cardTokens = tokens(textOf(card));
  let align = 0; for (const t of briefTokens) if (cardTokens.has(t)) align++;
  const alignment = align / Math.max(1, briefTokens.size);
  return Math.round(Math.min(1, .4*completeness + .25*alignment + .2*(card.assumptions.length&&card.validation.length?1:0)+.15*(card.artifacts.length&&card.nextAction&&Object.keys(card.modeFields).length?1:0))*10000)/10000;
}
function novelty(card: IdeaCard, texts: string[]): number { if (!texts.length) return 1; const t = tokens(textOf(card)); return Math.round((1 - Math.max(...texts.map(x => jaccard(t, tokens(x))))) * 10000) / 10000; }

export function selectDiverseCards(candidates: IdeaCard[], brief: CreativeBrief, genome: Record<string, number>, config: BurstConfig, existingTexts: string[] = []): Array<[IdeaCard, number, number]> {
  const map = new Map<string, IdeaCard>(); for (const c of candidates) if (!map.has(fingerprint(c))) map.set(fingerprint(c), c);
  const remaining = [...map.values()]; const selected: Array<[IdeaCard, number, number]> = []; const comp = [...existingTexts]; const fams = new Set<string>();
  while (remaining.length && selected.length < config.count) {
    const scored = remaining.map(card => { const n = novelty(card, comp); const c = cohesion(card, brief); const fb = fams.has(card.operatorFamily) ? 0 : 1; const s = (.4+.2*(genome.novelty_vs_utility??.5))*n + (.35+.1*(genome.taste_weight??.5))*c + .2*fb; return { card, n, c, s }; }).sort((a,b)=>b.s-a.s || a.card.operatorId.localeCompare(b.card.operatorId));
    const pick = scored.find(x => x.n >= 1-config.maximumSimilarity) ?? scored[0]; selected.push([pick.card,pick.n,pick.c]); fams.add(pick.card.operatorFamily); comp.push(textOf(pick.card)); remaining.splice(remaining.indexOf(pick.card),1);
  }
  return selected;
}

export class V10CreativeStore extends V9CompliancePlaneStore {
  profiles = new Map<string, Record<string, unknown>>(); workspaces = new Map<string, Record<string, unknown>>(); nodes = new Map<string, NodeRecord>(); edges: Array<{edgeId:string; workspaceId:string; sourceNodeId:string; targetNodeId:string; relation:EdgeRelation; rationale:string; createdUtc:string}> = []; confirmations: any[] = [];
  v10SchemaCurrent(): boolean { return true; }
}

export class CreativeStudio {
  constructor(public store: V10CreativeStore, public provider = new OfflineMorphologicalProvider()) {}
  bootstrapLocal(displayName = "Creator") { const runId = `run-v10-${sha256Text(displayName).slice(0,12)}`; const tenantId = `tenant-${sha256Text(displayName).slice(0,12)}`; const principalId = `principal-${sha256Text(displayName).slice(0,12)}`; const profileId = `profile-${sha256Text(displayName).slice(0,12)}`; this.store.createRun(runId, 42, "creative", "low", {version:V10_PROTOCOL_VERSION}); this.store.profiles.set(profileId,{profileId,displayName,tenantId,principalId,runId,createdUtc:utcNow()}); return {profileId,displayName,tenantId,principalId,runId}; }
  createWorkspace(profile: any, title: string, brief: CreativeBrief, seed: number): string { if(!title.trim()) throw new Error("Workspace title cannot be empty"); const genome=seedToGenome(seed); const persona=classifyPersonaExtended(genome); const path=selectPathExtended(genome); const workspaceId=`workspace-${sha256Text(profile.profileId+title+seed).slice(0,24)}`; const rootNodeId=`node-root-${workspaceId.slice(-18)}`; const now=utcNow(); this.store.workspaces.set(workspaceId,{workspaceId,tenantId:profile.tenantId,principalId:profile.principalId,runId:profile.runId,title,brief,mode:brief.mode,seed,genome,persona,path,rootNodeId,status:"active",createdUtc:now,updatedUtc:now}); this.store.nodes.set(rootNodeId,{nodeId:rootNodeId,workspaceId,nodeKind:"root",lifeStage:"seed",status:"active",title,body:{brief,persona,path,epistemic_status:"human-supplied creative seed"},operatorId:"human-seed",fingerprint:rawFingerprint({brief,persona,path}),localNovelty:1,cohesion:1,depth:0,createdBy:"human",createdUtc:now,updatedUtc:now}); return workspaceId; }
  workspaceBrief(workspaceId: string): CreativeBrief { return this.store.workspaces.get(workspaceId)?.brief as CreativeBrief; }
  workspaceNodes(workspaceId: string): NodeRecord[] { return [...this.store.nodes.values()].filter(n=>n.workspaceId===workspaceId).sort((a,b)=>a.depth-b.depth || a.createdUtc.localeCompare(b.createdUtc)); }
  private existingTexts(workspaceId:string){ return this.workspaceNodes(workspaceId).filter(n=>n.nodeKind==="idea"||n.nodeKind==="synthesis").map(n=>canonicalJson(n.body)); }
  private insertCards(workspaceId:string,parentIds:string[],relation:EdgeRelation,cards:Array<[IdeaCard,number,number]>,createdBy:string,nodeKind:NodeKind="idea"): NodeRecord[]{ const depth=Math.max(0,...parentIds.map(id=>this.store.nodes.get(id)?.depth??0))+1; const now=utcNow(); return cards.map(([card,n,c])=>{ const nodeId=`node-${sha256Text(workspaceId+fingerprint(card)+now).slice(0,24)}`; const rec:NodeRecord={nodeId,workspaceId,nodeKind,lifeStage:"branch",status:"active",title:card.title,body:card,operatorId:card.operatorId,fingerprint:fingerprint(card),localNovelty:n,cohesion:c,depth,createdBy,createdUtc:now,updatedUtc:now}; this.store.nodes.set(nodeId,rec); for(const p of parentIds)this.store.edges.push({edgeId:`edge-${sha256Text(p+nodeId+relation).slice(0,18)}`,workspaceId,sourceNodeId:p,targetNodeId:nodeId,relation,rationale:"creative growth",createdUtc:now}); return rec; }); }
  burst(workspaceId:string, config:BurstConfig={count:12,candidateMultiplier:4,maximumSimilarity:.82,minimumOperatorFamilies:6}, parentId?:string, operatorIds:string[]=[]):NodeRecord[]{ const w=this.store.workspaces.get(workspaceId)!; const parent=parentId??String(w.rootNodeId); const brief=this.workspaceBrief(workspaceId); const candidates=this.provider.generate(brief,w.genome as Record<string,number>,deriveSeed(w.seed,parent,this.workspaceNodes(workspaceId).length),Math.max(config.count,config.count*config.candidateMultiplier),operatorIds); return this.insertCards(workspaceId,[parent],parent===w.rootNodeId?"grows_from":"refines",selectDiverseCards(candidates,brief,w.genome as Record<string,number>,config,this.existingTexts(workspaceId)),"offline-morphological-engine"); }
  sprout(workspaceId:string,count=8):NodeRecord[]{ const w=this.store.workspaces.get(workspaceId)!; const root=String(w.rootNodeId); const now=utcNow(); const out:NodeRecord[]=[]; for(let i=0;i<count;i++){const op=OPERATORS[i%OPERATORS.length]; const kinds:NodeKind[]=["question","analogy","assumption","note"]; const kind=kinds[i%4]; const body={text:`${op.reflectionQuestion} — ${op.principle}`,epistemic_status:"open sprout — no answer selected"}; const nodeId=`node-${sha256Text(workspaceId+kind+i+now).slice(0,24)}`; const rec:NodeRecord={nodeId,workspaceId,nodeKind:kind,lifeStage:"sprout",status:"active",title:`${kind} · ${op.name}`,body,operatorId:op.operatorId,fingerprint:rawFingerprint(body),localNovelty:1,cohesion:1,depth:1,createdBy:"offline-morphological-engine",createdUtc:now,updatedUtc:now}; this.store.nodes.set(nodeId,rec); this.store.edges.push({edgeId:`edge-${sha256Text(root+nodeId).slice(0,18)}`,workspaceId,sourceNodeId:root,targetNodeId:nodeId,relation:kind==="question"?"asks":"grows_from",rationale:"deterministic sprout",createdUtc:now}); out.push(rec);} return out; }
  creativeExplosion(workspaceId:string,sproutCount=8,branchCount=16){ const sprouts=this.sprout(workspaceId,sproutCount); const branches=this.burst(workspaceId,{count:branchCount,candidateMultiplier:5,maximumSimilarity:.82,minimumOperatorFamilies:8}); return {workspaceId,sproutIds:sprouts.map(n=>n.nodeId),branchIds:branches.map(n=>n.nodeId),treeHealth:this.treeHealth(workspaceId),nextMoves:this.nextMoves(workspaceId)}; }
  crossPollinate(leftId:string,rightId:string):NodeRecord{ const l=this.store.nodes.get(leftId)!; const r=this.store.nodes.get(rightId)!; const lc=l.body as IdeaCard; const rc=r.body as IdeaCard; const card:IdeaCard={...lc,title:`Synthesis · ${l.title} × ${r.title}`,thesis:`Combine ${l.title} with ${r.title}.`,mechanism:`${lc.mechanism} + ${rc.mechanism}`,differentiation:"Explicit two-parent lineage.",operatorId:"cross-pollination",operatorFamily:"synthesis",morphology:{left_parent:leftId,right_parent:rightId},modeFields:{interaction_test:"Combined performance must exceed stronger parent."},tags:[...new Set(["synthesis",...lc.tags,...rc.tags])]}; const brief=this.workspaceBrief(l.workspaceId); return this.insertCards(l.workspaceId,[leftId,rightId],"combines",[[card,novelty(card,this.existingTexts(l.workspaceId)),cohesion(card,brief)]],"offline-morphological-engine","synthesis")[0]; }
  confirm(nodeId:string,dimension:ConfirmationDimension,verdict:ConfirmationVerdict,rating=3,rationale=""){ const node=this.store.nodes.get(nodeId)!; this.store.confirmations.push({nodeId,workspaceId:node.workspaceId,dimension,verdict,rating,rationale,createdUtc:utcNow()}); if(verdict==="reject"){node.status="rejected"; node.lifeStage="compost";} if(verdict==="confirm") node.status="favorite"; return `confirmation-${sha256Text(nodeId+dimension+verdict+Date.now()).slice(0,18)}`; }
  rankIdeas(workspaceId:string):RankedIdea[]{ return this.workspaceNodes(workspaceId).filter(n=>n.nodeKind==="idea"||n.nodeKind==="synthesis").map(n=>{const human=n.status==="favorite"?.9:n.status==="rejected"?0:.5; const pref=.5; const score=.6*human+.18*pref+.11*n.localNovelty+.11*n.cohesion; return {node:n,score:Math.round(score*10000)/10000,humanScore:human,preferenceScore:pref,noveltyScore:n.localNovelty,cohesionScore:n.cohesion};}).sort((a,b)=>b.score-a.score); }
  treeHealth(workspaceId:string):TreeHealth{ const nodes=this.workspaceNodes(workspaceId); const ideas=nodes.filter(n=>n.nodeKind==="idea"||n.nodeKind==="synthesis"); const fams=new Set(ideas.map(n=>(n.body as IdeaCard).operatorFamily)); const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0; return {nodeCount:nodes.length,branchCount:nodes.filter(n=>n.lifeStage==="branch").length,bloomCount:nodes.filter(n=>n.lifeStage==="bloom").length,fruitCount:nodes.filter(n=>n.lifeStage==="fruit").length,compostCount:nodes.filter(n=>n.lifeStage==="compost").length,operatorFamilyCount:fams.size,meanLocalNovelty:Math.round(mean(ideas.map(n=>n.localNovelty))*10000)/10000,meanCohesion:Math.round(mean(ideas.map(n=>n.cohesion))*10000)/10000,humanTouchRate:Math.round(nodes.filter(n=>n.createdBy==="human"||this.store.confirmations.some(c=>c.nodeId===n.nodeId)).length/Math.max(1,nodes.length)*10000)/10000,confirmationCount:this.store.confirmations.filter(c=>this.store.nodes.get(c.nodeId)?.workspaceId===workspaceId).length}; }
  nextMoves(workspaceId:string):string[]{ const h=this.treeHealth(workspaceId); const moves:string[]=[]; if(h.branchCount<8)moves.push("Run another creative burst to widen portfolio before selecting winner."); if(h.operatorFamilyCount<6)moves.push("Grow branches from underrepresented operator families."); const ranked=this.rankIdeas(workspaceId); for(const r of ranked.slice(0,3)) if(!this.store.confirmations.some(c=>c.nodeId===r.node.nodeId)) moves.push(`Confirm, reject, or revise “${r.node.title}”.`); return moves.length?moves:["Choose branch with most personal energy and perform smallest disconfirming test."]; }
  exportTerminal(workspaceId:string):string{ const nodes=this.workspaceNodes(workspaceId); return nodes.map(n=>`${"  ".repeat(n.depth)}${n.lifeStage}:${n.title}<${n.status}>`).join("\n"); }
  exportJson(workspaceId:string):string{ return JSON.stringify({protocolVersion:V10_PROTOCOL_VERSION,workspace:this.store.workspaces.get(workspaceId),nodes:this.workspaceNodes(workspaceId),edges:this.store.edges.filter(e=>e.workspaceId===workspaceId),ranking:this.rankIdeas(workspaceId),treeHealth:this.treeHealth(workspaceId),nextMoves:this.nextMoves(workspaceId),semantics:{novelty:"workspace-local dissimilarity only",verification:"generated branches remain unverified proposals"}},null,2); }
  /** 3D page adapter: get workspace record */
  workspace(workspaceId: string) { const w = this.store.workspaces.get(workspaceId); if (!w) throw new Error(workspaceId); return w as Record<string, unknown> & { brief: CreativeBrief; seed: number; rootNodeId: string }; }
  /** 3D page adapter: alias for workspaceNodes */
  nodes(workspaceId: string) { return this.workspaceNodes(workspaceId); }
  /** 3D page adapter: edges for workspace */
  edgesFor(workspaceId: string) { return this.store.edges.filter(e => e.workspaceId === workspaceId).map(e => ({ source_node_id: e.sourceNodeId, target_node_id: e.targetNodeId, relation: e.relation })); }
  /** 3D page adapter: list all workspaces */
  listWorkspaces() { return [...this.store.workspaces.values()].map(w => ({ workspace_id: (w as any).workspaceId, title: (w as any).title, mode: (w as any).mode, seed: (w as any).seed })); }
  /** 3D page adapter: expand a branch through a lens */
  expand(nodeId: string, lens: string, count = 6) { const node = this.store.nodes.get(nodeId); if (!node) throw new Error(nodeId); const brief = this.workspaceBrief(node.workspaceId); const w = this.workspace(node.workspaceId); const expanded: CreativeBrief = { ...brief, challenge: `Explore "${node.title}" through lens: ${lens}`, axes: { ...brief.axes, expansion_lens: [lens] } }; const candidates = this.provider.generate(expanded, w.genome as Record<string, number>, deriveSeed(w.seed, nodeId, lens), count * 4); return this.insertCards(node.workspaceId, [nodeId], "refines", selectDiverseCards(candidates, expanded, w.genome as Record<string, number>, { count, candidateMultiplier: 4, maximumSimilarity: 0.82, minimumOperatorFamilies: 4 }, this.existingTexts(node.workspaceId)), "offline-morphological-engine"); }
  /** 3D page adapter: fractal zoom — turn riskiest assumption into child problem */
  fractalZoom(nodeId: string, count = 5) { const node = this.store.nodes.get(nodeId); if (!node) throw new Error(nodeId); const card = node.body as IdeaCard; const assumption = card?.assumptions?.[0] ?? node.title; const questionBody = { text: `What must be true for this assumption to hold: ${assumption}`, unlocks: nodeId, epistemic_status: "open question" }; const qId = `node-${sha256Text(node.workspaceId + "zoom" + nodeId + utcNow()).slice(0, 24)}`; const now = utcNow(); const qRec: NodeRecord = { nodeId: qId, workspaceId: node.workspaceId, nodeKind: "question", lifeStage: "sprout", status: "active", title: "Fractal bottleneck", body: questionBody, operatorId: "fractal-zoom", fingerprint: rawFingerprint(questionBody), localNovelty: 1, cohesion: 1, depth: node.depth + 1, createdBy: "offline-morphological-engine", createdUtc: now, updatedUtc: now }; this.store.nodes.set(qId, qRec); this.store.edges.push({ edgeId: `edge-${sha256Text(nodeId + qId).slice(0, 18)}`, workspaceId: node.workspaceId, sourceNodeId: nodeId, targetNodeId: qId, relation: "asks", rationale: "fractal zoom", createdUtc: now }); const branches = this.expand(qId, "resolve or reframe the active bottleneck", count); return { question: qRec, branches }; }
  /** 3D page adapter: compost a branch (reject + preserve failure reason) */
  compost(nodeId: string, reason: string) { const node = this.store.nodes.get(nodeId); if (!node) throw new Error(nodeId); if (node.nodeKind === "root") throw new Error("Cannot compost root"); this.confirm(nodeId, "overall", "reject", 5, reason || "composted"); return node; }
  /** 3D page adapter: export in multiple formats */
  exportWorkspace(workspaceId: string, format: string): string { if (format === "json") return this.exportJson(workspaceId); if (format === "terminal" || format === "tree") return this.exportTerminal(workspaceId); if (format === "markdown") return `# Tree of Life\n\n${this.exportTerminal(workspaceId)}\n\n## Ranking\n\n${this.rankIdeas(workspaceId).map((r, i) => `${i + 1}. ${r.node.title} (${r.score.toFixed(2)})`).join("\n")}`; if (format === "mermaid") { const nodes = this.workspaceNodes(workspaceId); const edges = this.edgesFor(workspaceId); return ["flowchart TD", ...nodes.map(n => `  ${n.nodeId.replace(/[^a-zA-Z0-9]/g, "_")}["${n.lifeStage}: ${n.title.slice(0, 30).replace(/"/g, "'")}"]`), ...edges.map(e => `  ${e.source_node_id.replace(/[^a-zA-Z0-9]/g, "_")} -->|${e.relation}| ${e.target_node_id.replace(/[^a-zA-Z0-9]/g, "_")}`)].join("\n"); } return this.exportJson(workspaceId); }
  /** 3D page adapter: simplified createWorkspace without profile */
  createWorkspaceSimple(title: string, brief: CreativeBrief, seed: number): string { const profile = this.bootstrapLocal("Creator"); return this.createWorkspace(profile, title, brief, seed); }
}

export interface V10DiscoveryContext {
  seed: number;
  mode: CreativeMode;
  directive: string;
  searchAngles: string[];
  nextMoves: string[];
  tree: string;
  topBranches: Array<{ nodeId: string; title: string; thesis: string; mechanism: string; score: number }>;
}

/** Deterministic pipeline adapter. Produces directions and search angles, never truth claims. */
export function buildV10DiscoveryContext(challenge: string, mode: CreativeMode = "research", seed = deriveSeed(challenge, mode, "v10-pipeline")): V10DiscoveryContext {
  const store = new V10CreativeStore();
  const studio = new CreativeStudio(store);
  const profile = studio.bootstrapLocal("Pipeline");
  const brief: CreativeBrief = {
    challenge,
    mode,
    audience: ["intended user or decision-maker"],
    desiredOutcomes: ["an evidence-bound, useful answer"],
    constraints: ["do not invent facts; preserve uncertainty"],
    resources: ["retrieved evidence, existing tools, human judgment"],
    inspirationDomains: ["scientific instrumentation", "distributed systems", "ecology", "craft apprenticeship"],
    avoid: ["generic repetition", "unsupported novelty claims"],
    axes: { evidence_strategy: ["primary sources", "counter-evidence", "implementation evidence", "failure evidence"] },
  };
  const workspaceId = studio.createWorkspace(profile, concept(challenge), brief, seed);
  studio.creativeExplosion(workspaceId, 6, 10);
  const ranked = studio.rankIdeas(workspaceId).slice(0, 5);
  const topBranches = ranked.map(r => {
    const card = r.node.body as IdeaCard;
    return { nodeId: r.node.nodeId, title: card.title, thesis: card.thesis, mechanism: card.mechanism, score: r.score };
  });
  const searchAngles = topBranches.map((_b, i) => {
    const card = ranked[i].node.body as IdeaCard;
    return `${card.morphology.source_domain} ${card.operatorFamily} ${challenge} ${card.mechanism}`.replace(/\s+/g, " ").slice(0, 220);
  });
  const nextMoves = studio.nextMoves(workspaceId);
  const directive = [
    "## V10 CREATIVE TREE OF LIFE — DISCOVERY DIRECTIVE",
    "Generated branches are unverified proposals. Novelty means workspace-local dissimilarity only.",
    "Use branches as independent search/reasoning angles; do not merge until evidence supports them.",
    ...topBranches.map((b, i) => `${i + 1}. ${b.title}: ${b.mechanism}`),
    "SEARCH ANGLES:",
    ...searchAngles.map((q, i) => `S${i + 1}. ${q}`),
    "NEXT HUMAN/LOGIC MOVES:",
    ...nextMoves.map((m, i) => `N${i + 1}. ${m}`),
  ].join("\n");
  return { seed, mode, directive, searchAngles, nextMoves, tree: studio.exportTerminal(workspaceId), topBranches };
}

export function runInnovationGenomeV10Diagnostics(){ const checks:{id:string;passed:boolean;detail:string}[]=[]; const add=(id:string,passed:boolean,detail:string)=>checks.push({id,passed,detail}); const store=new V10CreativeStore(); const studio=new CreativeStudio(store); const profile=studio.bootstrapLocal("Creator"); const brief:CreativeBrief={challenge:"Create local-first research notebook",mode:"product",audience:["independent researcher"],desiredOutcomes:["better synthesis"],constraints:["no cloud dependency"],resources:["local files"],inspirationDomains:["gardening","version control"],avoid:[],axes:{interaction:["command palette","canvas"]}}; const ws=studio.createWorkspace(profile,"Notebook",brief,42); const explosion=studio.creativeExplosion(ws,4,8); add("schema-current",store.v10SchemaCurrent(),"v10 schema ok"); add("operators-20",OPERATORS.length===20,`operators=${OPERATORS.length}`); add("explosion",explosion.branchIds.length===8&&explosion.sproutIds.length===4,`${explosion.branchIds.length}/${explosion.sproutIds.length}`); const ranked=studio.rankIdeas(ws); add("ranked",ranked.length>=8,`ranked=${ranked.length}`); const confirmId=studio.confirm(ranked[0].node.nodeId,"overall","confirm",5,"strong"); add("confirm",confirmId.startsWith("confirmation-"),confirmId); const cross=studio.crossPollinate(ranked[0].node.nodeId,ranked[1].node.nodeId); add("cross-pollinate",cross.nodeKind==="synthesis","synthesis"); add("export-json",studio.exportJson(ws).includes("workspace-local dissimilarity only"),"semantics present"); add("terminal",studio.exportTerminal(ws).includes("seed:"),"tree text"); return {ok:checks.every(c=>c.passed),checks}; }

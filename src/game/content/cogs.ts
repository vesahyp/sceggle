import { L, type Text } from '../../i18n';

/**
 * Cogs: what you pick on the lift between floors. Each changes a rule or a
 * number for the rest of the run, and most can be taken again for more.
 * The numbers are read where the rule lives, through cogLevel(hero, id).
 */
export interface CogDef {
  id: string;
  name: Text;
  icon: string;
  max: number;
  /** what the next level does, for the card */
  desc: (next: number) => Text;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export const COGS: CogDef[] = [
  { id: 'kimmoke', name: L('Kimmoke', 'Ricochet'), icon: '↯', max: 3, desc: (n) => L(`Luodit pomppivat seinistä, ${n} kerta${n > 1 ? 'a' : ''}.`, `Bullets bounce off walls, ${n} time${n > 1 ? 's' : ''}.`) },
  { id: 'lapaisy', name: L('Läpäisy', 'Pierce'), icon: '➶', max: 3, desc: (n) => L(`Luodit menevät ${n} vihollisen läpi.`, `Bullets pass through ${n} more enem${n > 1 ? 'ies' : 'y'}.`) },
  { id: 'kattila', name: L('Isompi kattila', 'Bigger Boiler'), icon: '◉', max: 3, desc: () => L('Yksi lipas lisää kumpaankin aseeseen.', 'One more ammo segment on both guns.') },
  { id: 'lataus', name: L('Pikalataus', 'Quick Reload'), icon: '⟳', max: 4, desc: () => L('Lataa 18 % nopeammin.', 'Reloads 18% faster.') },
  { id: 'tuli', name: L('Kuumakäynti', 'Running Hot'), icon: '🔥', max: 3, desc: (n) => L(`Osumat sytyttävät. Palo tekee ${pct(0.25 * n)} osuman vahingosta sekunnissa.`, `Hits set fire. The burn deals ${pct(0.25 * n)} of the hit each second.`) },
  { id: 'tesla', name: L('Teslakela', 'Tesla Coil'), icon: 'ϟ', max: 3, desc: (n) => L(`Joka neljäs osuma hyppää ${n + 1} viholliseen.`, `Every fourth hit jumps to ${n + 1} enemies.`) },
  { id: 'pakkanen', name: L('Pakkasventtiili', 'Frost Valve'), icon: '❄', max: 2, desc: () => L('Osumat hidastavat vihollista.', 'Hits slow enemies down.') },
  { id: 'ruumis', name: L('Paineruumis', 'Pressure Corpse'), icon: '✸', max: 3, desc: (n) => L(`Kaatuneet räjähtävät, säde ${30 + 15 * n}.`, `The fallen explode, radius ${30 + 15 * n}.`) },
  { id: 'imu', name: L('Höyryimu', 'Steam Siphon'), icon: '♨', max: 3, desc: (n) => L(`Jokainen kaato parantaa ${n * 2}.`, `Every kill heals ${n * 2}.`) },
  { id: 'ylipaine', name: L('Ylipaine', 'Overpressure'), icon: '⇈', max: 3, desc: (n) => L(`Täydellä lippaalla ensimmäinen laukaus tekee +${pct(0.5 * n)}.`, `With full ammo, the first shot deals +${pct(0.5 * n)}.`) },
  { id: 'monipiippu', name: L('Monipiippu', 'Extra Barrel'), icon: '⋔', max: 2, desc: () => L('Yksi ammus lisää jokaiseen laukaukseen, vahinko −10 %.', 'One more projectile on every shot, damage −10%.') },
  { id: 'tahtain', name: L('Tähtäin', 'Gunsight'), icon: '⌖', max: 3, desc: () => L('Kantama +20 %, luodit 15 % nopeampia.', 'Range +20%, bullets 15% faster.') },
  { id: 'magneetti', name: L('Magneetti', 'Magnet'), icon: '⊂', max: 2, desc: () => L('Kolikot ja höyry tulevat luoksesi kauempaa.', 'Coins and steam come to you from farther away.') },
  { id: 'panssari', name: L('Kuparilevyt', 'Copper Plating'), icon: '⛨', max: 4, desc: () => L('Ottaa 10 % vähemmän vahinkoa.', 'Takes 10% less damage.') },
  { id: 'saappaat', name: L('Höyrysaappaat', 'Steam Boots'), icon: '⇶', max: 3, desc: () => L('Liikkuu 10 % nopeammin.', 'Moves 10% faster.') },
  { id: 'varaaja', name: L('Supervaraaja', 'Super Capacitor'), icon: '★', max: 3, desc: () => L('Supervoima latautuu 35 % nopeammin.', 'The super charges 35% faster.') },
  { id: 'vaihde', name: L('Pikavaihde', 'Quick Swap'), icon: '⇄', max: 1, desc: () => L('Aseen vaihto täyttää uuden aseen lippaat. Kerran neljässä sekunnissa.', 'Swapping fills the new gun. Once every four seconds.') },
  { id: 'jalkipolte', name: L('Jälkipoltto', 'Afterburner'), icon: '∞', max: 2, desc: (n) => L(`Supervoiman jälkeen ${n * 2} s loputtomat ammukset.`, `After a super, ${n * 2} s of endless ammo.`) },
  { id: 'sirpaleet', name: L('Sirpaleet', 'Shrapnel'), icon: '✦', max: 2, desc: (n) => L(`Osuessaan luoti hajoaa ${n * 2 + 1} sirpaleeksi.`, `On impact a bullet breaks into ${n * 2 + 1} fragments.`) },
  { id: 'vaali', name: L('Venttiili', 'Relief Valve'), icon: '⛭', max: 2, desc: () => L('Kun terveys putoaa alle kolmannekseen, purkaus heittää viholliset pois. Kerran kerroksessa.', 'When health falls under a third, a blast throws enemies away. Once a floor.') },
  { id: 'kulta', name: L('Kultasormi', 'Golden Touch'), icon: '◆', max: 3, desc: () => L('Paremmat aseet putoavat useammin. Kolikoita 25 % enemmän.', 'Better guns drop more often. 25% more coins.') },
  { id: 'elinvoima', name: L('Valurautasydän', 'Cast-iron Heart'), icon: '♥', max: 4, desc: () => L('Terveys +25, ja parantaa täyteen.', 'Health +25, and heals you to full.') },
];

export const COG_BY_ID: Record<string, CogDef> = Object.fromEntries(COGS.map((c) => [c.id, c]));

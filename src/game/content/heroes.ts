import { L, type Text } from '../../i18n';
import type { GunType, Maker } from '../types';

export type SuperKind = 'dash' | 'turret' | 'leap' | 'slam';

/**
 * Who you play. Each hero has a starting gun, a passive and a super. The
 * super is charged by damage dealt (`superCost` points of damage fill it)
 * and is the one thing the hero always has, whatever gun they pick up.
 */
export interface HeroDef {
  id: string;
  name: Text;
  title: Text;
  desc: Text;
  hp: number;
  speed: number;
  start: { type: GunType; maker: Maker };
  super: SuperKind;
  superName: Text;
  superDesc: Text;
  passive: Text;
  /** passive numbers, read by stats() */
  reloadMul: number;
  armor: number;
  blastMul: number;
  /** body colours for the sprite: coat, hat, skin */
  coat: string;
  hat: string;
}

export const HEROES: HeroDef[] = [
  {
    id: 'nuohooja',
    name: L('Nuohooja', 'The Sweep'),
    title: L('Katoilta alas', 'Down from the rooftops'),
    desc: L('Nopea ja lähellä. Haulikko ja nokipilvi.', 'Fast and close. A scattergun and a soot cloud.'),
    hp: 110,
    speed: 168,
    start: { type: 'scatter', maker: 'paukku' },
    super: 'dash',
    superName: L('Nokisyöksy', 'Soot Dash'),
    superDesc: L('Syöksyy, osuu kaikkeen matkalla ja jättää nokipilven, jossa viholliset eivät näe.', 'Dashes, hits everything on the way and leaves a soot cloud where enemies cannot see.'),
    passive: L('Liikkuu 10 % nopeammin.', 'Moves 10% faster.'),
    reloadMul: 1,
    armor: 0,
    blastMul: 1,
    coat: '#2a2a30',
    hat: '#111114',
  },
  {
    id: 'konemestari',
    name: L('Konemestari', 'The Engineer'),
    title: L('Korjaa kaiken, rikkoo loput', 'Fixes it all, breaks the rest'),
    desc: L('Keskimatka. Revolveri ja oma tykkitorni.', 'Mid range. A revolver and a turret of her own.'),
    hp: 100,
    speed: 150,
    start: { type: 'revolver', maker: 'rattaat' },
    super: 'turret',
    superName: L('Tykkitorni', 'Turret'),
    superDesc: L('Pystyttää tornin, joka ampuu samalla aseella kuin sinä kahdeksan sekuntia.', 'Sets down a turret that fires the gun you hold for eight seconds.'),
    passive: L('Lataa 15 % nopeammin.', 'Reloads 15% faster.'),
    reloadMul: 0.85,
    armor: 0,
    blastMul: 1,
    coat: '#7a4a22',
    hat: '#c8a040',
  },
  {
    id: 'ilmalaivuri',
    name: L('Ilmalaivuri', 'The Aeronaut'),
    title: L('Tuuli on aina myötäinen', 'The wind is always behind her'),
    desc: L('Kaukaa yli seinien. Mörssäri ja hyppy.', 'From afar, over walls. A mortar and a leap.'),
    hp: 90,
    speed: 150,
    start: { type: 'mortar', maker: 'torpeedo' },
    super: 'leap',
    superName: L('Ilmahyppy', 'Sky Leap'),
    superDesc: L('Hyppää minne tähtäät ja laskeutuu iskuun, joka lennättää viholliset.', 'Leaps where you aim and lands with a stomp that throws enemies away.'),
    passive: L('Räjähdykset ovat 20 % suurempia.', 'Blasts are 20% larger.'),
    reloadMul: 1,
    armor: 0,
    blastMul: 1.2,
    coat: '#3a5a8a',
    hat: '#6a3a1a',
  },
  {
    id: 'seppa',
    name: L('Seppä', 'The Smith'),
    title: L('Alasin kulkee mukana', 'Brings the anvil along'),
    desc: L('Kestää. Höyrykeihäs ja maahan isku.', 'Takes a beating. A steam lance and a ground slam.'),
    hp: 150,
    speed: 140,
    start: { type: 'lance', maker: 'kipina' },
    super: 'slam',
    superName: L('Alasin', 'Anvil'),
    superDesc: L('Isku maahan heittää viholliset kauas, ja suoja kestää kolme sekuntia.', 'A slam that throws enemies back, then a shield for three seconds.'),
    passive: L('Ottaa 15 % vähemmän vahinkoa.', 'Takes 15% less damage.'),
    reloadMul: 1,
    armor: 0.15,
    blastMul: 1,
    coat: '#5a3a2a',
    hat: '#3a3a3a',
  },
];

export const HERO_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));

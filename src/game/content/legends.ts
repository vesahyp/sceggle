import { L, type Text } from '../../i18n';
import type { Gun, GunType, Maker } from '../types';

/**
 * Orange guns. Each has a name, a fixed type and maker, a line of flavour
 * and one rule that no rolled gun has. The rule is applied in two places:
 * `apply` changes the numbers when the gun is rolled, and the sim checks
 * `gun.legend` where the rule lives (weapons.ts, combat.ts).
 */
export interface LegendDef {
  name: Text;
  type: GunType;
  maker: Maker;
  rule: Text;
  apply: (g: Gun) => void;
}

export const LEGENDS: Record<string, LegendDef> = {
  kahvipannu: {
    name: L('Kahvipannu', 'The Coffee Pot'),
    type: 'lance',
    maker: 'kipina',
    rule: L('Ampuu kuumaa kahvia. Osumat parantavat sinua.', 'Sprays hot coffee. Its hits heal you.'),
    apply: (g) => {
      g.element = 'fire';
      g.damage *= 1.1;
    },
  },
  kakikello: {
    name: L('Käkikello', 'The Cuckoo Clock'),
    type: 'revolver',
    maker: 'kello',
    rule: L('Joka kuudes laukaus on käki, joka ei luovuta.', 'Every sixth shot is a cuckoo that will not give up.'),
    apply: (g) => {
      g.ammo = 6;
      g.reload *= 0.7;
    },
  },
  sateenvarjo: {
    name: L('Mummon sateenvarjo', "Granny's Umbrella"),
    type: 'scatter',
    maker: 'paukku',
    rule: L('Kun et ammu, varjo torjuu luodit edestäsi.', 'While you are not firing, it blocks the bullets in front of you.'),
    apply: (g) => {
      g.count += 2;
    },
  },
  kiuas: {
    name: L('Kiuas', 'The Sauna Stove'),
    type: 'mortar',
    maker: 'torpeedo',
    rule: L('Ammus jättää löylyn: se polttaa vihollisia ja parantaa sinua.', 'The shell leaves löyly behind: it scalds enemies and heals you.'),
    apply: (g) => {
      g.blast *= 1.15;
    },
  },
  tukkijatka: {
    name: L('Tukkijätkä', 'The Log Driver'),
    type: 'saw',
    maker: 'rattaat',
    rule: L('Terät pomppivat seinistä kahdeksan kertaa eivätkä pysähdy vihollisiin.', 'Blades bounce off walls eight times and do not stop at enemies.'),
    apply: (g) => {
      g.bounces = 8;
      g.pierce = 99;
      g.range *= 1.6;
    },
  },
  veturi: {
    name: L('Höyryveturi', 'The Locomotive'),
    type: 'rifle',
    maker: 'torpeedo',
    rule: L('Laukaus menee kaiken läpi ja jättää palavan raiteen.', 'The shot goes through everything and leaves a burning track.'),
    apply: (g) => {
      g.pierce = 99;
      g.blast = 0;
      g.speed = 700;
      g.damage *= 1.2;
    },
  },
  voimala: {
    name: L('Voimalaitos', 'The Power Plant'),
    type: 'revolver',
    maker: 'kipina',
    rule: L('Jokainen osuma hyppää kolmeen viereiseen.', 'Every hit jumps to three more.'),
    apply: (g) => {
      g.element = 'shock';
    },
  },
  leipalapio: {
    name: L('Leipälapio', 'The Bread Peel'),
    type: 'scatter',
    maker: 'heittola',
    rule: L('Heitetty ase hajoaa kahdeksaksi palaksi, jotka pomppivat.', 'The thrown gun breaks into eight pieces that bounce.'),
    apply: (g) => {
      g.damage *= 1.1;
    },
  },
};

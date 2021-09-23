import { Notice } from "obsidian";
import type DiceRollerPlugin from "src/main";
import { ResultMapInterface, Conditional, Lexeme } from "src/types";
import { _insertIntoMap } from "src/utils/util";
import { BaseRoller, GenericRoller, Roller } from "./roller";

interface Modifier {
    conditionals: Conditional[];
    data: number;
}

export class DiceRoller {
    dice: string;
    modifiers: Map<string, Modifier> = new Map();
    rolls: number;
    faces: { min: number; max: number };
    results: ResultMapInterface<number>;
    resultArray: number[];
    modifiersAllowed: boolean = true;
    static: boolean = false;
    conditions: Conditional[] = [];

    get text() {
        return `${this.result}`;
    }

    get result() {
        if (this.static) {
            return Number(this.dice);
        }
        const results = [...this.results].map(([, { usable, value }]) =>
            usable ? value : 0
        );
        return results.reduce((a, b) => a + b, 0);
    }
    get display() {
        if (this.static) {
            return `${this.result}`;
        }
        return `[${[...this.results]
            .map(
                ([, { modifiers, display }]) =>
                    `${display}${[...modifiers].join("")}`
            )
            .join(", ")}]`;
    }
    constructor(dice: string, public lexeme: Lexeme = {
        original: dice,
        conditionals: [],
        type: 'dice',
        data: dice
    }) {
        if (!/(\-?\d+)[dD]?(\d+|%|\[\d+,\s?\d+\])?/.test(dice)) {
            throw new Error("Non parseable dice string passed to DiceRoll.");
        }
        this.dice = dice.split(" ").join("");

        if (/^-?\d+$/.test(this.dice)) {
            this.static = true;
            this.modifiersAllowed = false;
        }
        let [, rolls, min = null, max = 1] = this.dice.match(
            /(\-?\d+)[dD]\[?(?:(-?\d+)\s?,)?\s?(-?\d+|%|F)\]?/
        ) || [, 1, null, 1];
        this.rolls = Number(rolls) || 1;
        if (Number(max) < 0 && !min) {
            min = -1;
        }
        if (max === "%") max = 100;
        if (max === "F") {
            max = 1;
            min = -1;
        }
        if (Number(max) < Number(min)) {
            [max, min] = [min, max];
        }

        this.faces = { max: max ? Number(max) : 1, min: min ? Number(min) : 1 };

        this.conditions = this.lexeme.conditionals ?? [];

        this.results = new Map(
            [...this.roll()].map((n, i) => {
                return [
                    i,
                    {
                        usable: true,
                        value: n,
                        display: `${n}`,
                        modifiers: new Set()
                    }
                ];
            })
        );
    }
    keepLow(drop: number = 1) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        /* if (this.conditions?.length) {
            new Notice("Modifiers are not permitted on conditioned dice.");
            return;
        } */

        [...this.results]
            .sort((a, b) => a[1].value - b[1].value)
            .slice(drop - this.results.size)
            .forEach(([index]) => {
                const previous = this.results.get(index);
                previous.usable = false;
                previous.modifiers.add("d");
                this.results.set(index, { ...previous });
            });
    }
    keepHigh(drop: number = 1) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        /* if (this.conditions?.length) {
            new Notice("Modifiers are not permitted on conditioned dice.");
            return;
        } */
        [...this.results]
            .sort((a, b) => b[1].value - a[1].value)
            .slice(drop)
            .forEach(([index]) => {
                const previous = this.results.get(index);
                previous.usable = false;
                previous.modifiers.add("d");
                this.results.set(index, { ...previous });
            });
    }
    reroll(times: number, conditionals: Conditional[]) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        /* if (this.conditions?.length) {
            new Notice("Modifiers are not permitted on conditioned dice.");
            return;
        } */
        /**
         * Build Conditional
         */
        if (!conditionals.length) {
            conditionals.push({
                operator: "=",
                comparer: this.faces.min
            });
        }

        /**
         * Find values that pass the conditional.
         */
        let i = 0,
            toReroll = [...this.results].filter(([, { value }]) =>
                this.checkCondition(value, conditionals)
            );
        while (
            i < times &&
            toReroll.filter(([, { value }]) =>
                this.checkCondition(value, conditionals)
            ).length > 0
        ) {
            i++;
            toReroll.map(([, roll]) => {
                roll.modifiers.add("r");
                roll.value = this.getRandomBetween(
                    this.faces.min,
                    this.faces.max
                );
            });
        }

        toReroll.forEach(([index, value]) => {
            this.results.set(index, value);
        });
    }
    explodeAndCombine(times: number, conditionals: Conditional[]) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        /* if (this.conditions?.length) {
            new Notice("Modifiers are not permitted on conditioned dice.");
            return;
        } */

        /**
         * Build Conditional
         */
        if (!conditionals.length) {
            conditionals.push({
                operator: "=",
                comparer: this.faces.max
            });
        }

        /**
         * Find values that pass the conditional
         */
        let i = 0,
            toExplode = [...this.results].filter(([, { value }]) =>
                this.checkCondition(value, conditionals)
            );

        toExplode.forEach(([index, value]) => {
            let newRoll = this.getRandomBetween(this.faces.min, this.faces.max);
            i++;
            value.modifiers.add("!");
            value.value += newRoll;
            value.display = `${value.value}`;
            this.results.set(index, value);
            while (i < times && this.checkCondition(newRoll, conditionals)) {
                i++;
                newRoll = this.getRandomBetween(this.faces.min, this.faces.max);
                value.value += newRoll;
                value.display = `${value.value}`;
                this.results.set(index, value);
            }
        });
    }
    explode(times: number, conditionals: Conditional[]) {
        if (!this.modifiersAllowed) {
            new Notice("Modifiers are only allowed on dice rolls.");
            return;
        }
        /* if (this.conditions?.length) {
            new Notice("Modifiers are not permitted on conditioned dice.");
            return;
        } */

        /**
         * Build Conditional
         */
        if (!conditionals.length) {
            conditionals.push({
                operator: "=",
                comparer: this.faces.max
            });
        }

        /**
         * Find values that pass the conditional
         */
        let toExplode = [...this.results].filter(([, { value }]) =>
            this.checkCondition(value, conditionals)
        );

        /** Track how many have been inserted */
        let inserted = 0;

        /** Loop through values that need to explode */
        toExplode.forEach(([key, value]) => {
            /** newRoll is the new value to check against the max face value */
            let newRoll = value.value;
            /** i tracks how many times this roll has been exploded */
            let i = 0;

            /**
             * Explode max rolls.
             */
            while (i < times && this.checkCondition(newRoll, conditionals)) {
                let previous = this.results.get(key + inserted + i);
                previous.modifiers.add("!");

                newRoll = this.getRandomBetween(this.faces.min, this.faces.max);

                /** Insert the new roll into the results map */
                _insertIntoMap(this.results, key + inserted + i + 1, {
                    usable: true,
                    value: newRoll,
                    display: `${newRoll}`,
                    modifiers: new Set()
                });
                i++;
            }
            /** Update how many have been inserted. */
            inserted += i;
        });
    }
    _roll(): number[] {
        if (this.static) {
            return [Number(this.dice)];
        }
        return [...Array(this.rolls)].map(() =>
            this.getRandomBetween(this.faces.min, this.faces.max)
        );
    }
    roll() {
        const roll = this._roll();
        this.results = new Map(
            [...roll].map((n, i) => {
                return [
                    i,
                    {
                        usable: true,
                        value: n,
                        display: `${n}`,
                        modifiers: new Set()
                    }
                ];
            })
        );

        for (let [type, modifier] of this.modifiers) {
            this.applyModifier(type, modifier);
        }
        if (this.conditions?.length) this.applyConditions();

        return roll;
    }
    applyConditions() {
        for (let [index, result] of this.results) {
            const negate = this.conditions.find(
                ({ operator }) => operator === "-=" || operator === "=-"
            );
            if (negate) {
                if (result.value === negate.comparer) {
                    result.value = -1;
                    result.modifiers.add("-");
                    continue;
                }
            }

            const check = this.checkCondition(result.value, this.conditions);

            if (!check) {
                result.usable = false;
            } else {
                result.modifiers.add("*");
                result.value = 1;
            }
        }
    }
    applyModifier(type: string, modifier: Modifier) {
        switch (type) {
            case "kh": {
                this.keepHigh(modifier.data);
                break;
            }
            case "kl": {
                this.keepLow(modifier.data);
                break;
            }
            case "!": {
                this.explode(modifier.data, modifier.conditionals);
                break;
            }
            case "!!": {
                this.explodeAndCombine(modifier.data, modifier.conditionals);
                break;
            }
            case "r": {
                this.reroll(modifier.data, modifier.conditionals);
                break;
            }
            case "condition": {
            }
        }
    }

    private checkCondition(
        value: number,
        conditions: Conditional[]
    ): boolean | number {
        if (!conditions || !conditions.length) return value;
        return conditions.some(({ operator, comparer }) => {
            if (Number.isNaN(value) || Number.isNaN(comparer)) {
                return false;
            }
            let result = false;
            switch (operator) {
                case "=":
                    result = value === comparer;
                    break;
                case "!=":
                case "=!":
                    result = value !== comparer;
                    break;
                case "<":
                    result = value < comparer;
                    break;
                case "<=":
                    result = value <= comparer;
                    break;
                case ">":
                    result = value > comparer;
                    break;
                case ">=":
                    result = value >= comparer;
                    break;
            }

            return result;
        });
    }
    getRandomBetween(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

class StuntRoller extends DiceRoller {
    constructor(dice: string, public lexeme: Lexeme) {
        super(`3d6`, lexeme);

        this.dice = dice;
    }
    get doubles() {
        return (
            new Set(
                [...this.results].map(([, { usable, value }]) =>
                    usable ? value : 0
                )
            ).size < 3
        );
    }
    get result() {
        if (this.static) {
            return Number(this.dice);
        }
        const results = [...this.results].map(([, { usable, value }]) =>
            usable ? value : 0
        );
        return results.reduce((a, b) => a + b, 0);
    }
    get display() {
        let str: string[] = [];
        for (let result of this.results) {
            if (result[0] == 0 && this.doubles) {
                str.push(`${result[1].value}S`);
                continue;
            }
            str.push(`${result[1].value}`);
        }
        return `[${str.join(", ")}]`;
    }
}

export class StackRoller extends GenericRoller<number> {
    result: number;
    stunted: string = "";
    private _tooltip: string;
    get tooltip() {
        if (this._tooltip) return this._tooltip;
        let text = this.original;
        this.dice.forEach((dice) => {
            text = text.replace(dice.lexeme.original, dice.display);
        });
        return `${this.original}\n${text}`;
    }

    async build() {
        const result = [
            this.result.toLocaleString(navigator.language, {
                maximumFractionDigits: 2
            })
        ];
        if (this.plugin.data.displayResultsInline) {
            result.unshift(this.inlineText);
        }
        this.resultEl.setText(result.join("") + this.stunted);
    }

    constructor(
        public plugin: DiceRollerPlugin,
        public original: string,
        public lexemes: Lexeme[]
    ) {
        super(plugin, original, lexemes);
    }
    operators: Record<string, (...args: number[]) => number> = {
        "+": (a: number, b: number): number => a + b,
        "-": (a: number, b: number): number => a - b,
        "*": (a: number, b: number): number => a * b,
        "/": (a: number, b: number): number => a / b,
        "^": (a: number, b: number): number => {
            return Math.pow(a, b);
        }
    };
    stack: DiceRoller[] = [];
    dice: DiceRoller[] = [];
    async roll() {
        let index = 0;
        this.stunted = "";
        for (const dice of this.lexemes) {
            switch (dice.type) {
                case "+":
                case "-":
                case "*":
                case "/":
                case "^":
                case "math":
                    let b = this.stack.pop(),
                        a = this.stack.pop();
                    if (!a) {
                        this.stack.push(b);
                        continue;
                    }
                    b.roll();
                    if (b instanceof StuntRoller) {
                        if (b.doubles) {
                            this.stunted = ` - ${
                                b.results.get(0).value
                            } Stunt Points`;
                        }
                    }

                    a.roll();
                    if (a instanceof StuntRoller) {
                        if (a.doubles) {
                            this.stunted = ` - ${
                                a.results.get(0).value
                            } Stunt Points`;
                        }
                    }
                    const result = this.operators[dice.data](
                        a.result,
                        b.result
                    );

                    this.stack.push(new DiceRoller(`${result}`, dice));
                    break;
                case "kh": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.data ? Number(dice.data) : 1;

                    diceInstance.modifiers.set("kh", {
                        data,
                        conditionals: []
                    });
                    break;
                }
                case "dl": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.data ? Number(dice.data) : 1;

                    data = diceInstance.results.size - data;

                    diceInstance.modifiers.set("kh", {
                        data,
                        conditionals: []
                    });
                    break;
                }
                case "kl": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.data ? Number(dice.data) : 1;

                    diceInstance.modifiers.set("kl", {
                        data,
                        conditionals: []
                    });
                    break;
                }
                case "dh": {
                    let diceInstance = this.dice[index - 1];
                    let data = dice.data ? Number(dice.data) : 1;

                    data = diceInstance.results.size - data;

                    diceInstance.modifiers.set("kl", {
                        data,
                        conditionals: []
                    });
                    break;
                }
                case "!": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.data) || 1;

                    diceInstance.modifiers.set("!", {
                        data,
                        conditionals: dice.conditionals
                    });

                    break;
                }
                case "!!": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.data) || 1;

                    diceInstance.modifiers.set("!!", {
                        data,
                        conditionals: dice.conditionals
                    });

                    break;
                }
                case "r": {
                    let diceInstance = this.dice[index - 1];
                    let data = Number(dice.data) || 1;

                    diceInstance.modifiers.set("r", {
                        data,
                        conditionals: dice.conditionals
                    });
                    break;
                }
                case "dice":
                    if (!this.dice[index]) {
                        this.dice[index] = new DiceRoller(dice.data, dice);
                    }

                    this.stack.push(this.dice[index]);
                    index++;
                    break;
                case "stunt":
                    if (!this.dice[index]) {
                        this.dice[index] = new StuntRoller(dice.original, dice);
                    }

                    this.stack.push(this.dice[index]);
                    index++;
            }
        }

        const final = this.stack.pop();
        final.roll();
        if (final instanceof StuntRoller) {
            if (final.doubles) {
                this.stunted = ` - ${final.results.get(0).value} Stunt Points`;
            }
        }
        this.result = final.result;
        this._tooltip = null;

        this.render();

        this.trigger("new-result");
        return this.result;
    }

    toResult() {
        return {
            type: "dice",
            result: this.result,
            tooltip: this.tooltip
        };
    }
    async applyResult(result: any) {
        if (result.type !== "dice") return;
        if (result.result) {
            this.result = result.result;
        }
        if (result.tooltip) {
            this._tooltip = result.tooltip;
        }
        await this.render();
    }
}

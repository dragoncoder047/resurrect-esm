import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { describe, expect, test } from "bun:test";
import { NamespaceResolver, Resurrect, ResurrectError, ResurrectOptions } from "./resurrect";

GlobalRegistrator.register();

function suite(opt?: ResurrectOptions) {

    const defOpts = new Resurrect(opt);

    function roundtrip<T>(obj: T, options?: ResurrectOptions): T {
        const serializer = new Resurrect({ ...options, ...opt });
        const str = serializer.stringify(obj);
        return serializer.resurrect(str);
    }

    test("primitive serialization", () => {
        expect(roundtrip(1)).toBe(1);
        expect(roundtrip(null)).toBeNull();
        expect(roundtrip(undefined)).toBeUndefined();
        expect(roundtrip("foo")).toBe("foo");
        expect(roundtrip(NaN)).toBeNaN();
        expect(roundtrip(Infinity)).toBeGreaterThan(Number.MAX_VALUE);
        expect(roundtrip(-Infinity)).toBeLessThan(Number.MIN_VALUE);
    });

    test("basic JSON serialization", () => {
        const obj = { a: 1, b: 2, c: [1, 2, { d: 3 }], e: null, f: true };
        expect(roundtrip(obj, { cleanup: true })).toEqual(obj);
    });

    test("non-JSON atoms in an object", () => {
        const obj = { a: null, b: undefined, c: NaN, d: Infinity, e: -Infinity };
        expect(roundtrip(obj, { cleanup: true })).toEqual(obj);
    });

    test("serialization with circular references", () => {
        const obj = { a: 1, b: 2, c: null as any };
        obj.c = obj;
        expect(roundtrip(obj, { cleanup: true })).toEqual(obj);
    });

    test("serialization with shared structure", () => {
        const obj = { a: 1, b: 2 };
        const arr = [obj, obj, { obj }] as const;
        const roundtripped = roundtrip(arr, { cleanup: true });
        expect(roundtripped).toEqual(arr);
        expect(roundtripped[0]).toBe(roundtripped[1]);
        expect(roundtripped[1]).toBe(roundtripped[2].obj);
    });

    test("serialization with Date and RegExp", () => {
        const obj = { a: new Date, b: /abc/gu };
        expect(roundtrip(obj, { cleanup: true })).toEqual(obj);
    });

    test("serialization with DOM elements", () => {
        const obj = new Resurrect.Node("<span id=foo><a id=1></a></span>");
        const roundtripped = roundtrip(obj);
        expect(roundtripped).toBeInstanceOf(HTMLSpanElement);
        expect(roundtripped.firstChild).toBeInstanceOf(HTMLAnchorElement);
    });

    test("doesn't try to serialize a function", () => {
        const obj = { foo() { } };
        expect(() => roundtrip(obj)).toThrow(new ResurrectError("Can't serialize functions."));
    });

    if (defOpts.revive) {
        test("revive and custom resolver", () => {
            class Dog {
                constructor(public loudness: number, public sound: string) { }
                woof() { return this.sound.repeat(this.loudness) + "!"; }
            }
            const obj = new Dog(3, "wow");
            const roundtripped = roundtrip(obj, {
                resolver: new NamespaceResolver({ Dog }),
            });
            expect(roundtripped).toBeInstanceOf(Dog);
            expect(roundtripped.woof()).toEqual("wowwowwow!");
        });
        test("can't serialize anonymous classes", () => {
            const obj = new class {
                foo: number;
                constructor() {
                    this.foo = 1;
                }
            };
            expect(() => roundtrip(obj)).toThrow(new ResurrectError("Can't serialize objects with anonymous constructors."))
        });
    } else {
        test("no revive preserves own properties but not functionality", () => {
            class Dog {
                constructor(public loudness: number, public sound: string) { }
                woof() { return this.sound.repeat(this.loudness) + "!"; }
            }
            const obj = new Dog(3, "wow");
            const roundtripped = roundtrip(obj, {
                resolver: new NamespaceResolver({ Dog }),
            });
            expect(roundtripped).not.toBeInstanceOf(Dog);
            expect(roundtripped.woof).toBeUndefined();
        });
    }
}

describe("default options", () => suite());
describe("custom prefix", () => suite({ prefix: "qwerty" }));
describe("no revive", () => suite({ revive: false }));

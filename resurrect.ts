/**
 * # ResurrectJS
 * @version 1.0.3
 * @license Public Domain
 *
 * ResurrectJS preserves object behavior (prototypes) and reference
 * circularity with a special JSON encoding. Unlike regular JSON,
 * Date, RegExp, DOM objects, and `undefined` are also properly
 * preserved.
 *
 * ## Examples
 *
 * function Foo() {}
 * Foo.prototype.greet = function() { return "hello"; };
 *
 * // Behavior is preserved:
 * const necromancer = new Resurrect();
 * const json = necromancer.stringify(new Foo());
 * const foo = necromancer.resurrect(json);
 * foo.greet();  // => "hello"
 *
 * // References to the same object are preserved:
 * json = necromancer.stringify([foo, foo]);
 * const array = necromancer.resurrect(json);
 * array[0] === array[1];  // => true
 * array[1].greet();  // => "hello"
 *
 * // Dates are restored properly
 * json = necromancer.stringify(new Date());
 * const date = necromancer.resurrect(json);
 * Object.prototype.toString.call(date);  // => "[object Date]"
 *
 * ## Options
 *
 * Options are provided to the constructor as an object with these
 * properties:
 *
 *   prefix ('#'): A prefix string used for temporary properties added
 *     to objects during serialization and deserialization. It is
 *     important that you don't use any properties beginning with this
 *     string. This option must be consistent between both
 *     serialization and deserialization.
 *
 *   cleanup (false): Perform full property cleanup after both
 *     serialization and deserialization using the `delete`
 *     operator. This may cause performance penalties (breaking hidden
 *     classes in V8) on objects that ResurrectJS touches, so enable
 *     with care.
 *
 *   revive (true): Restore behavior (__proto__) to objects that have
 *     been resurrected. If this is set to false during serialization,
 *     resurrection information will not be encoded. You still get
 *     circularity and Date support.
 *
 *   resolver (Resurrect.NamespaceResolver(window)): Converts between
 *     a name and a prototype. Create a custom resolver if your
 *     constructors are not stored in global variables. The resolver
 *     has two methods: getName(object) and getPrototype(string).
 *
 * For example,
 *
 * const necromancer = new Resurrect({
 *     prefix: '__#',
 *     cleanup: true
 * });
 *
 * ## Caveats
 *
 *   * With the default resolver, all constructors must be named and
 *   stored in the global variable under that name. This is required
 *   so that the prototypes can be looked up and reconnected at
 *   resurrection time.
 *
 *   * The wrapper objects Boolean, String, and Number will be
 *   unwrapped. This means extra properties added to these objects
 *   will not be preserved.
 *
 *   * Functions cannot ever be serialized. Resurrect will throw an
 *   error if a function is found when traversing a data structure.
 *
 * @see http://nullprogram.com/blog/2013/03/28/
 */

export class Resurrect {
    private _table: any[] | null;
    prefix: string;
    cleanup: boolean;
    revive: boolean;
    get _refcode() { return this.prefix + "#" };
    get _backrefcode() { return this.prefix + "=" };
    get _protocode() { return this.prefix + "+" };
    get _origcode() { return this.prefix + "&" };
    get _buildcode() { return this.prefix + "@" };
    get _valuecode() { return this.prefix + "_" };
    resolver: NamespaceResolver;
    constructor(opt: ResurrectOptions = {}) {
        this._table = null;
        this.prefix = opt.prefix ?? "#";
        this.cleanup = opt.cleanup ?? false;
        this.revive = opt.revive ?? true;
        this.resolver = opt.resolver ?? new NamespaceResolver(Resurrect.GLOBAL as any);
    }

    /**
     * Portable access to the global object (window, global).
     * Uses indirect eval.
     * @constant
     */
    static readonly GLOBAL: typeof globalThis = globalThis ?? (0, eval)("this");

    /**
     * Escape special regular expression characters in a string.
     * Uses `RegExp.escape` if available, otherwise falls back to http://stackoverflow.com/a/6969486.
     * @param {string} string
     * @returns {string} The string escaped for exact matches.
     */
    private static _escapeRegExp = RegExp.escape ?? ((string: string) => string.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&"));

    /**
     * Create a DOM node from HTML source; behaves like a constructor.
     */
    static Node = class {
        constructor(html: string) {
            const div = document.createElement("a");
            div.innerHTML = html;
            return div.firstChild as HTMLElement;
        }
    } as new (x: string) => HTMLElement;

    private static _is(type: string) {
        const string = `[object ${type}]`;
        return (obj: any) => {
            return {}.toString.call(obj) === string;
        };
    }

    private static _isArray = Resurrect._is("Array") as (obj: any) => obj is any[];
    private static _isString = Resurrect._is("String") as (obj: any) => obj is string;
    private static _isBoolean = Resurrect._is("Boolean") as (obj: any) => obj is boolean;
    private static _isNumber = Resurrect._is("Number") as (obj: any) => obj is number;
    private static _isFunction = Resurrect._is("Function") as (obj: any) => obj is Function;
    private static _isDate = Resurrect._is("Date") as (obj: any) => obj is Date;
    private static _isRegExp = Resurrect._is("RegExp") as (obj: any) => obj is RegExp;
    private static _isObject = Resurrect._is("Object") as (obj: any) => obj is object;
    private static isAtom(object: any) {
        return !Resurrect._isObject(object) && !Resurrect._isArray(object);
    }
    private static _isPrimitive(object: any) {
        return object == null ||
            Resurrect._isNumber(object) ||
            Resurrect._isString(object) ||
            Resurrect._isBoolean(object);
    }

    /**
     * Create a reference (encoding) to an object.
     */
    private _ref(object: any) {
        return {
            [this._backrefcode]: object === undefined ? -1 : object[this._refcode],
        };
    }

    /**
     * Lookup an object in the table by reference object.
     */
    private _deref(ref: any) {
        return this._table![ref[this._backrefcode]];
    }

    /**
     * Put a temporary identifier on an object and store it in the table.
     */
    private _tag(object: any): number {
        if (this.revive) {
            const constructor = this.resolver.getName(object);
            if (constructor) {
                const proto = Object.getPrototypeOf(object);
                if (this.resolver.getPrototype(constructor) !== proto) {
                    throw new ResurrectError("Constructor mismatch!");
                } else {
                    object[this._protocode] = constructor;
                }
            }
        }
        object[this._refcode] = this._table!.length;
        this._table!.push(object);
        return object[this._refcode];
    }

    /**
     * Create a builder object (encoding) for serialization.
     * @param value The value to pass to the constructor.
     */
    private _builder(name: string, value: any): object {
        return {
            [this._buildcode]: name,
            [this._valuecode]: value
        };
    }

    /**
     * Build a value from a deserialized builder.
     * @see http://stackoverflow.com/a/14378462
     * @see http://nullprogram.com/blog/2013/03/24/
     */
    private _build(ref: any): any {
        const type = this.resolver.getConstructor(ref[this._buildcode]);
        /* Brilliant hack by kybernetikos: */
        const result: any = new (type.bind.apply(type, [null].concat(ref[this._valuecode]) as [any, any[]]))();
        if (Resurrect._isPrimitive(result)) {
            return result.valueOf(); // unwrap
        } else {
            return result;
        }
    }

    /**
     * Dereference or build an object or value from an encoding.
     * @method
     */
    private _decode(ref: object): object | undefined {
        if (this._backrefcode in ref) {
            return this._deref(ref);
        } else if (this._buildcode in ref) {
            return this._build(ref);
        } else {
            throw new ResurrectError("Unknown encoding.");
        }
    }

    /**
     * @returns {boolean} True if the provided object is tagged for serialization.
     */
    private _isTagged(object: any): boolean {
        return (this._refcode in object) && (object[this._refcode] != null);
    }


    /**
     * Visit root and all its ancestors, visiting atoms with f.
     * @returns A fresh copy of root to be serialized.
     */
    private _visit(root: any, f: (obj: any) => any, replacer?: (k: string, v: any) => any): any {
        if (Resurrect.isAtom(root)) {
            return f(root);
        } else if (!this._isTagged(root)) {
            let copy: any = null;
            if (Resurrect._isArray(root)) {
                copy = [];
                root[this._refcode as any] = this._tag(copy);
                for (let i = 0; i < root.length; i++) {
                    copy.push(this._visit(root[i], f, replacer));
                }
            } else { /* Object */
                copy = Object.create(Object.getPrototypeOf(root));
                root[this._refcode as any] = this._tag(copy);
                for (const key in root) {
                    let value = root[key];
                    if (root.hasOwnProperty(key)) {
                        if (replacer && value !== undefined) {
                            // Call replacer like JSON.stringify's replacer
                            value = replacer.call(root, key, root[key]);
                            if (value === undefined) {
                                continue; // Omit from result
                            }
                        }
                        copy[key] = this._visit(value, f, replacer);
                    }
                }
            }
            copy[this._origcode] = root;
            return this._ref(copy);
        } else {
            return this._ref(root);
        }
    }

    /**
     * Manage special atom values, possibly returning an encoding.
     */
    private _handleAtom(atom: any): any {
        const Node = Resurrect.GLOBAL.Node || function () { };
        if (Resurrect._isFunction(atom)) {
            throw new ResurrectError("Can't serialize functions.");
        } else if (atom instanceof Node) {
            return this._builder("Resurrect.Node", [new XMLSerializer().serializeToString(atom)]);
        } else if (Resurrect._isDate(atom)) {
            return this._builder("Date", [atom.toISOString()]);
        } else if (Resurrect._isRegExp(atom)) {
            return this._builder("RegExp", ("" + atom).match(/\/(.+)\/([a-z]*)/)!.slice(1));
        } else if (atom === undefined) {
            return this._ref(undefined);
        } else if (Resurrect._isNumber(atom) && (isNaN(atom) || !isFinite(atom))) {
            return this._builder("Number", ["" + atom]);
        } else {
            return atom;
        }
    }

    /**
     * Hides intrusive keys from a user-supplied replacer.
     * @method
     */
    private _replacerWrapper<K extends string, V, U>(replacer: (k: K, v: V) => U): (k: K, v: V) => U | V {
        const skip = new RegExp("^" + Resurrect._escapeRegExp(this.prefix));
        return (k, v) => {
            if (skip.test(k)) {
                return v;
            } else {
                return replacer(k, v);
            }
        }
    }

    /**
     * Serialize an arbitrary JavaScript object, carefully preserving it.
     */
    stringify(object: any, replacer?: any[] | ((k: string, v: any) => any), space?: string) {
        if (Resurrect._isFunction(replacer)) {
            replacer = this._replacerWrapper(replacer);
        } else if (Resurrect._isArray(replacer)) {
            const acceptKeys = replacer;
            replacer = function (k, v) {
                return acceptKeys.indexOf(k) >= 0 ? v : undefined;
            };
        }
        if (Resurrect.isAtom(object)) {
            return JSON.stringify(this._handleAtom(object), replacer, space);
        } else {
            this._table = [];
            this._visit(object, this._handleAtom.bind(this), replacer);
            for (let i = 0; i < this._table.length; i++) {
                if (this.cleanup) {
                    delete this._table[i][this._origcode][this._refcode];
                } else {
                    this._table[i][this._origcode][this._refcode] = null;
                }
                delete this._table[i][this._refcode];
                delete this._table[i][this._origcode];
            }
            const table = this._table;
            this._table = null;
            return JSON.stringify(table, null, space);
        }
    }

    /**
     * Restore the `__proto__` of the given object to the proper value.
     * @method
     */
    private _fixPrototype<T extends object>(object: T): T {
        if (this._protocode in object) {
            const name = (object as any)[this._protocode];
            const prototype = this.resolver.getPrototype(name);
            if ("__proto__" in object) {
                object.__proto__ = prototype;
                if (this.cleanup) {
                    delete (object as any)[this._protocode];
                }
                return object;
            } else { // IE
                const copy = Object.create(prototype);
                for (const key in object) {
                    if (object.hasOwnProperty(key) && key !== this.prefix) {
                        copy[key] = object[key];
                    }
                }
                return copy;
            }
        } else {
            return object;
        }
    }

    /**
     * Deserialize an encoded object, restoring circularity and behavior.
     */
    resurrect(string: string): any {
        let result = null;
        const data = JSON.parse(string);
        if (Resurrect._isArray(data)) {
            this._table = data;
            /* Restore __proto__. */
            if (this.revive) {
                for (let i = 0; i < this._table.length; i++) {
                    this._table[i] = this._fixPrototype(this._table[i]);
                }
            }
            /* Re-establish object references and construct atoms. */
            for (let i = 0; i < this._table.length; i++) {
                const object = this._table[i];
                for (const key in object) {
                    if (object.hasOwnProperty(key)) {
                        if (!(Resurrect.isAtom(object[key]))) {
                            object[key] = this._decode(object[key]);
                        }
                    }
                }
            }
            result = this._table[0];
        } else if (Resurrect._isObject(data)) {
            this._table = [];
            result = this._decode(data);
        } else {
            result = data;
        }
        this._table = null;
        return result;
    }
}


export interface ResurrectOptions {
    /**
     * A prefix string used for temporary properties added
     * to objects during serialization and deserialization. It is
     * important that you don't use any properties beginning with this
     * string. This option must be consistent between both
     * serialization and deserialization.
     */
    prefix?: string;
    /**
     * Perform full property cleanup after both
     * serialization and deserialization using the `delete`
     * operator. This may cause performance penalties (breaking hidden
     * classes in V8) on objects that ResurrectJS touches, so enable
     * with care.
     */
    cleanup?: boolean;
    /**
     * Restore behavior (`__proto__`) to objects that have
     * been resurrected. If this is set to false during serialization,
     * resurrection information will not be encoded. You still get
     * circularity and Date support.
     */
    revive?: boolean;
    /**
     * Converts between a name and a prototype. Create a custom
     * resolver if your constructors are not stored in global variables.
     *
     * If you're using ES6 modules for your custom classes, you WILL need
     * to use this!
     */
    resolver?: NamespaceResolver;
}

export class ResurrectError extends Error { }

/**
 * Resolves prototypes through the properties on an object and
 * constructor names.
 */
export class NamespaceResolver {
    constructor(public scope: Record<string, new (...args: any[]) => any>) { }
    /**
     * Gets the prototype of the given property name from an object. If
     * not found, throws an error.
     */
    getPrototype(name: string): any {
        const constructor = this.scope[name];
        if (constructor) {
            return constructor.prototype;
        }
        throw new ResurrectError("Unknown constructor: " + name);
    }
    /**
     * Get the prototype name for an object, to be fetched later with
     * {@link getPrototype} and {@link getConstructor}.
     * @returns null if the constructor is `Object` or `Array`.
     */
    getName(object: object): string | null {
        let constructor = object.constructor.name;
        if (constructor == null) { // IE
            constructor = /^\s*function\s*([A-Za-z0-9_$]*)/.exec("" + object.constructor)?.[1] ?? "";
        }
        if (constructor === "") {
            throw new ResurrectError("Can't serialize objects with anonymous constructors.");
        }
        return constructor === "Object" || constructor === "Array" ? null : constructor;
    }

    /**
     * Get the constructor function for the object prototype name. For backwards compatibility
     * purposes, falls back to treating the string as a dot-separated path on `globalThis` if the
     * object's constructor isn't in the namespace.
     */
    getConstructor(name: string): new (...args: any[]) => any {
        return (name === "Resurrect.Node" ? Resurrect.Node : this.scope[name] ?? name.split(/\./).reduce((object, name) => {
            return (object as any)[name];
        }, Resurrect.GLOBAL)) as unknown as new () => any;
    }
}

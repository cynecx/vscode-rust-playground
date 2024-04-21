export function groupBy<T, K, V>(
    elems: T[],
    keyFn: (val: T) => K,
    keyValFn: (key: K) => string | number,
    mapFn: (key: K, val: T) => V,
): { key: K; values: V[] }[] {
    const map: Map<string | number, { key: K; values: V[] }> = new Map();

    for (const elem of elems) {
        const key = keyFn(elem);
        const keyVal = keyValFn(key);
        let entry = map.get(keyVal);
        if (!entry) {
            entry = { key, values: [] };
            map.set(keyVal, entry);
        }
        entry.values.push(mapFn(key, elem));
    }

    return [...map.values()];
}

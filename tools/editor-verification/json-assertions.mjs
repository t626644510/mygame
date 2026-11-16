const pointerPart = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

// All keys and array entries are compared. No field allowlist or coercion is used.
export function compareTrees(expected, actual, pointer = '') {
  const differences = [];
  function visit(left, right, location) {
    if (kind(left) !== kind(right)) {
      differences.push({ pointer: location, issue: 'type', expected: kind(left), actual: kind(right) });
      return;
    }
    if (Array.isArray(left)) {
      if (left.length !== right.length) differences.push({ pointer: location, issue: 'array-length', expected: left.length, actual: right.length });
      for (let index = 0; index < Math.min(left.length, right.length); index++) visit(left[index], right[index], `${location}/${index}`);
    } else if (left !== null && typeof left === 'object') {
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();
      for (const key of leftKeys) {
        if (!Object.hasOwn(right, key)) differences.push({ pointer: `${location}/${pointerPart(key)}`, issue: 'missing-key', expected: left[key] });
        else visit(left[key], right[key], `${location}/${pointerPart(key)}`);
      }
      for (const key of rightKeys) if (!Object.hasOwn(left, key)) differences.push({ pointer: `${location}/${pointerPart(key)}`, issue: 'unexpected-key', actual: right[key] });
    } else if (!Object.is(left, right) && !(left === 0 && right === 0)) {
      differences.push({ pointer: location, issue: 'value', expected: left, actual: right });
    }
  }
  visit(expected, actual, pointer);
  return differences;
}

export const runtimeItemFields = ['schemaVersion', 'id', 'aliases', 'name', 'category', 'description', 'icon', 'stackLimit', 'baseValue', 'tags', 'equipment', 'consumable'];

export function runtimeProjection(items) {
  return {
    schemaVersion: 1,
    items: items.filter(item => item.draft !== true).map(item => {
      const output = {};
      for (const field of runtimeItemFields) {
        if (!Object.hasOwn(item, field)) throw new Error(`Validated source is missing ${item.id}/${field}`);
        output[field] = structuredClone(item[field]);
      }
      return output;
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  };
}

export function findMetadataKeys(value, pointer = '') {
  const found = [];
  if (Array.isArray(value)) value.forEach((entry, index) => found.push(...findMetadataKeys(entry, `${pointer}/${index}`)));
  else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const location = `${pointer}/${pointerPart(key)}`;
      if (['draft', 'notes'].includes(key)) found.push(location);
      found.push(...findMetadataKeys(entry, location));
    }
  }
  return found;
}

(function installResourceModel(scope) {
  const PROPERTY_TYPES = Object.freeze([
    { id: "text", label: "텍스트" }, { id: "number", label: "숫자" },
    { id: "select", label: "선택" }, { id: "multi_select", label: "다중 선택" },
    { id: "checkbox", label: "체크박스" }, { id: "date", label: "날짜" },
  ]);
  const COLORS = Object.freeze(["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]);
  const TYPE_IDS = new Set(PROPERTY_TYPES.map((type) => type.id));
  const MAX_FILTER_DEPTH = 16;
  const MAX_GROUP_ORDER_KEYS = 1000;
  const BUILTINS = [
    ["title", "이름", "text"], ["boxId", "Box", "select"], ["projectId", "Project", "select"],
    ["type", "종류", "select"], ["importance", "중요도", "select"],
    ["pinned", "고정", "checkbox"], ["readLater", "나중에 읽기", "checkbox"],
    ["createdAt", "생성일", "date"], ["updatedAt", "수정일", "date"],
  ];
  const BUILTIN_IDS = new Set(BUILTINS.map(([id]) => id));
  const EMPTY_OPERATORS = [["is_empty", "비어 있음"], ["is_not_empty", "비어 있지 않음"]];
  const EQUALITY_OPERATORS = [["equals", "같음"], ["not_equals", "같지 않음"]];
  const OPERATORS = {
    text: [["contains", "포함"], ["not_contains", "포함하지 않음"], ...EQUALITY_OPERATORS, ["starts_with", "시작함"], ["ends_with", "끝남"], ...EMPTY_OPERATORS],
    number: [...EQUALITY_OPERATORS, ["gt", "초과"], ["gte", "이상"], ["lt", "미만"], ["lte", "이하"], ["between", "범위"], ...EMPTY_OPERATORS],
    checkbox: EQUALITY_OPERATORS,
    select: [...EQUALITY_OPERATORS, ["is_any_of", "다음 중 하나"], ["is_none_of", "다음 모두 제외"], ...EMPTY_OPERATORS],
    multi_select: [["contains", "포함"], ["does_not_contain", "포함하지 않음"], ["contains_all", "모두 포함"], ["contains_any", "하나 이상 포함"], ["contains_none", "모두 제외"], ...EMPTY_OPERATORS],
    date: [["on", "해당 날짜"], ["before", "이전"], ["after", "이후"], ["on_or_before", "이전 또는 같음"], ["on_or_after", "이후 또는 같음"], ["between", "기간"], ["relative", "상대 날짜"], ...EMPTY_OPERATORS],
  };
  const RELATIVE_PERIODS = new Set(["today", "yesterday", "tomorrow", "this_week", "last_week", "next_week", "this_month", "last_month", "next_month", "past_days", "next_days"]);
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const empty = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) || (plain(value) && !value.start);

  function normalizeSettings(settings = {}) {
    if (!plain(settings)) settings = {};
    const resourceProperties = (Array.isArray(settings.resourceProperties) ? settings.resourceProperties : []).filter(plain).map((property) => ({ ...property, options: (Array.isArray(property.options) ? property.options : []).filter(plain) }));
    function normalizeGroup(value, id, depth = 0) {
      const group = plain(value) ? value : {};
      const rules = Array.isArray(group.rules) ? group.rules : typeof group.propertyId === "string" ? [group] : [];
      return {
        ...group, id: typeof group.id === "string" && Array.isArray(group.rules) ? group.id : id,
        op: group.op === "or" ? "or" : "and",
        rules: depth >= MAX_FILTER_DEPTH ? [] : rules.filter(plain).map((rule, index) => own(rule, "rules")
          ? normalizeGroup(rule, `${id}-${index}`, depth + 1) : { ...rule }),
      };
    }
    const savedViews = (Array.isArray(settings.resourceViews) ? settings.resourceViews : []).filter(plain);
    const resourceViews = savedViews.length
      ? savedViews.map((view, index) => ({
        ...view, id: typeof view.id === "string" && view.id ? view.id : `resource-view-${index + 1}`,
        name: typeof view.name === "string" && view.name.trim() ? view.name : "자료 보기",
        filter: normalizeGroup(view.filter, `${view.id || index}-filter`),
        sorts: (Array.isArray(view.sorts) ? view.sorts : []).filter(plain), groups: (Array.isArray(view.groups) ? view.groups : []).filter(plain),
        visibleProperties: Array.isArray(view.visibleProperties) ? view.visibleProperties : [], layout: view.layout === "table" ? "table" : "list",
      }))
      : [{ id: "all", name: "전체 자료", filter: { id: "all-filter", op: "and", rules: [] }, sorts: [], groups: [], visibleProperties: [], layout: "list" }];
    return {
      ...settings, resourceProperties, resourceViews,
      activeResourceViewId: resourceViews.some((view) => view.id === settings.activeResourceViewId) ? settings.activeResourceViewId : resourceViews[0].id,
    };
  }

  function getProperties(state) {
    const resources = Array.isArray(state?.resources) ? state.resources : [];
    const existingOptions = (field, defaults) => [...new Set([...defaults, ...resources.map((item) => item?.[field]).filter((id) => typeof id === "string" && id)])].map((id) => ({ id, name: id, color: "default" }));
    const options = {
      boxId: (Array.isArray(state?.boxes) ? state.boxes : []).filter(Boolean).map((item) => ({ id: item.id, name: item.name || item.title || "제목 없음", color: "default" })),
      projectId: (Array.isArray(state?.projects) ? state.projects : []).filter(Boolean).map((item) => ({ id: item.id, name: item.name || item.title || "제목 없음", color: "default" })),
      type: existingOptions("type", ["note", "link", "article", "book", "video", "file"]),
      importance: existingOptions("importance", ["normal", "important"]),
    };
    return [...BUILTINS.map(([id, name, type]) => ({ id, name, type, builtin: true, options: options[id] || [] })), ...(state?.settings?.resourceProperties || [])];
  }

  function getValue(resource, propertyId, state) {
    if (propertyId === "createdAt" || propertyId === "updatedAt") {
      const value = resource?.[propertyId];
      if (!value || !Number.isFinite(Date.parse(value))) return null;
      const date = new Date(value);
      return { start: localDate(date, true), end: "", includeTime: true };
    }
    if (propertyId === "pinned" || propertyId === "readLater") return resource?.[propertyId] === true;
    if (BUILTIN_IDS.has(propertyId)) return resource?.[propertyId] ?? null;
    const value = own(resource?.propertyValues, propertyId) ? resource.propertyValues[propertyId] : null;
    return value === null && state?.settings?.resourceProperties?.some((property) => property.id === propertyId && property.type === "checkbox") ? false : value;
  }

  function filterOperators(type) {
    return (Array.isArray(OPERATORS[type]) ? OPERATORS[type] : []).map(([id, label]) => ({ id, label }));
  }

  function localDate(date, includeTime = false) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${includeTime ? `T${pad(date.getHours())}:${pad(date.getMinutes())}` : ""}`;
  }

  function relativeRange(value, today = new Date()) {
    const base = typeof today === "string" ? new Date(`${today.slice(0, 10)}T12:00:00`) : new Date(today);
    base.setHours(12, 0, 0, 0);
    const start = new Date(base);
    const end = new Date(base);
    const period = value?.period;
    if (period === "yesterday" || period === "tomorrow") {
      start.setDate(start.getDate() + (period === "yesterday" ? -1 : 1));
      end.setTime(start.getTime());
    } else if (period?.endsWith("_week")) {
      start.setDate(start.getDate() - (start.getDay() + 6) % 7 + (period === "last_week" ? -7 : period === "next_week" ? 7 : 0));
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 6);
    } else if (period?.endsWith("_month")) {
      start.setDate(1);
      start.setMonth(start.getMonth() + (period === "last_month" ? -1 : period === "next_month" ? 1 : 0));
      end.setTime(start.getTime());
      end.setMonth(end.getMonth() + 1, 0);
    } else if (period === "past_days") {
      start.setDate(start.getDate() - (Number(value.days || 1) - 1));
    } else if (period === "next_days") {
      end.setDate(end.getDate() + (Number(value.days || 1) - 1));
    }
    return { start: localDate(start), end: localDate(end) };
  }

  function matchesFilter(resource, filter, state, today, properties = new Map(getProperties(state).map((property) => [property.id, property]))) {
    function match(rule, depth = 0) {
      if (!rule || depth > MAX_FILTER_DEPTH) return false;
      if (Array.isArray(rule.rules)) {
        if (!rule.rules.length) return true;
        return rule.op === "or" ? rule.rules.some((child) => match(child, depth + 1)) : rule.rules.every((child) => match(child, depth + 1));
      }
      const property = properties.get(rule.propertyId);
      if (!property) return false;
      const actual = getValue(resource, property.id, state);
      const expected = rule.value;
      const operator = rule.operator;
      if (operator === "is_empty") return empty(actual);
      if (operator === "is_not_empty") return !empty(actual);
      // A newly added condition remains inactive until a comparison value is entered.
      if (expected === "" || expected === null || expected === undefined || (Array.isArray(expected) && !expected.length)) return true;
      if (property.type === "checkbox") return operator === "not_equals" ? Boolean(actual) !== expected : Boolean(actual) === expected;
      if (property.type === "multi_select" || property.type === "select") {
        const values = Array.isArray(actual) ? actual : empty(actual) ? [] : [actual];
        const targets = Array.isArray(expected) ? expected : [expected];
        const any = targets.some((value) => values.includes(value));
        if (["not_equals", "does_not_contain", "is_none_of", "contains_none"].includes(operator)) return !any;
        return operator === "contains_all" ? targets.every((value) => values.includes(value)) : any;
      }
      if (property.type === "date") {
        if (empty(actual)) return false;
        const value = actual.start;
        const compare = (target) => target?.includes("T") ? value : value.slice(0, 10);
        if (operator === "relative" || operator === "between") {
          const range = operator === "relative" ? relativeRange(expected, today) : expected;
          return (!range.start || compare(range.start) >= range.start) && (!range.end || compare(range.end) <= range.end);
        }
        if (operator === "on") return compare(expected) === expected;
        if (operator === "before") return compare(expected) < expected;
        if (operator === "after") return compare(expected) > expected;
        if (operator === "on_or_before") return compare(expected) <= expected;
        if (operator === "on_or_after") return compare(expected) >= expected;
        return false;
      }
      if (property.type === "number") {
        if (empty(actual)) return false;
        if (operator === "between") return (empty(expected.start) || actual >= Number(expected.start)) && (empty(expected.end) || actual <= Number(expected.end));
        if (operator === "equals") return actual === Number(expected);
        if (operator === "not_equals") return actual !== Number(expected);
        if (operator === "gt") return actual > Number(expected);
        if (operator === "gte") return actual >= Number(expected);
        if (operator === "lt") return actual < Number(expected);
        if (operator === "lte") return actual <= Number(expected);
        return false;
      }
      const text = String(actual ?? "").toLocaleLowerCase();
      const target = String(expected).toLocaleLowerCase();
      if (operator === "contains") return text.includes(target);
      if (operator === "not_contains") return !text.includes(target);
      if (operator === "equals") return text === target;
      if (operator === "not_equals") return text !== target;
      if (operator === "starts_with") return text.startsWith(target);
      if (operator === "ends_with") return text.endsWith(target);
      return false;
    }
    return !filter || match(filter);
  }

  function displayValue(value, property) {
    if (empty(value)) return "비어 있음";
    if (property?.type === "checkbox") return value ? "선택됨" : "선택 안 됨";
    if (property?.type === "date") return typeof value === "string" ? value.replace("T", " ") : `${value.start.replace("T", " ")}${value.end ? ` → ${value.end.replace("T", " ")}` : ""}`;
    if (property?.type === "number") {
      const format = property.numberFormat;
      const options = format === "percent" ? { style: "percent", maximumFractionDigits: 6 } : format === "won" || format === "dollar" ? { style: "currency", currency: format === "won" ? "KRW" : "USD", maximumFractionDigits: 6 } : { maximumFractionDigits: 10 };
      return new Intl.NumberFormat("ko-KR", options).format(value);
    }
    if (property?.type === "select" || property?.type === "multi_select") {
      return (Array.isArray(value) ? value : [value]).map((id) => property.options?.find((option) => option.id === id)?.name || String(id)).join(", ");
    }
    return String(value);
  }

  function applyView(resources, view, state) {
    const properties = new Map(getProperties(state).map((property) => [property.id, property]));
    return resources.filter((resource) => matchesFilter(resource, view?.filter, state, undefined, properties)).sort((left, right) => {
      for (const sort of view?.sorts || []) {
        const property = properties.get(sort.propertyId);
        if (!property) continue;
        const a = getValue(left, property.id, state);
        const b = getValue(right, property.id, state);
        if (empty(a) || empty(b)) {
          if (empty(a) !== empty(b)) return empty(a) ? 1 : -1;
          continue;
        }
        const comparison = compareValues(a, b, property);
        if (comparison) return comparison * (sort.direction === "desc" ? -1 : 1);
      }
      return 0;
    });
  }

  function compareValues(a, b, property) {
    if (property.type === "number" || property.type === "checkbox") return Number(a) - Number(b);
    if (property.type === "date") return collator.compare(a.start || a, b.start || b);
    if (["select", "multi_select"].includes(property.type) && !["boxId", "projectId"].includes(property.id)) {
      const order = new Map((property.options || []).map((option, index) => [option.id, index]));
      const ranks = (value) => (Array.isArray(value) ? value : [value]).map((id) => order.get(id) ?? order.size).sort((left, right) => left - right);
      const left = ranks(a);
      const right = ranks(b);
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
        if (left[index] !== right[index]) return left[index] - right[index];
      }
      return left.length - right.length;
    }
    return collator.compare(displayValue(a, property), displayValue(b, property));
  }

  function groupValueKeys(resource, propertyId, state) {
    const value = getValue(resource, propertyId, state);
    if (empty(value)) return [null];
    if (Array.isArray(value)) return [...new Set(value)];
    if (plain(value)) return [value.start.slice(0, 10)];
    return [value];
  }

  function orderGroupKeys(keys, group, property) {
    const customOrder = group?.direction === "custom" && Array.isArray(group.customOrder) ? group.customOrder : [];
    const ranks = new Map(customOrder.map((key, index) => [key, index]));
    return [...keys].sort((left, right) => {
      const rankDifference = (ranks.get(left) ?? ranks.size) - (ranks.get(right) ?? ranks.size);
      if (rankDifference) return rankDifference;
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      return compareValues(left, right, property) * (group?.direction === "desc" ? -1 : 1);
    });
  }

  function validDate(value, includeTime = true) {
    if (typeof value !== "string" || !(includeTime ? /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false;
    const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10)
      && (!value.includes("T") || (Number(value.slice(11, 13)) < 24 && Number(value.slice(14)) < 60));
  }

  function validateState(state) {
    const issues = [];
    const add = (path, message) => { if (issues.length < 100) issues.push({ path, code: "invalid_resource_property", message }); };
    const identifier = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
    const name = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 200;
    const properties = state?.settings?.resourceProperties;
    const views = state?.settings?.resourceViews;
    if (properties !== undefined && (!Array.isArray(properties) || properties.length > 500)) add("state.settings.resourceProperties", "Properties must be an array with at most 500 entries.");
    const propertyMap = new Map(getProperties({ ...state, settings: {} }).map((property) => [property.id, property]));
    for (const [index, property] of (Array.isArray(properties) ? properties : []).entries()) {
      const path = `state.settings.resourceProperties[${index}]`;
      if (!plain(property)) { add(path, "Property must be an object."); continue; }
      if (!identifier(property.id) || propertyMap.has(property.id)) add(`${path}.id`, "Property ID must be unique and must not shadow a built-in property.");
      if (!name(property.name)) add(`${path}.name`, "Property name must contain 1 to 200 characters.");
      if (!TYPE_IDS.has(property.type)) add(`${path}.type`, "Unsupported property type.");
      if (property.numberFormat !== undefined && !["number", "percent", "won", "dollar"].includes(property.numberFormat)) add(`${path}.numberFormat`, "Unsupported number format.");
      if (property.options !== undefined && (!Array.isArray(property.options) || property.options.length > 1000)) add(`${path}.options`, "Options must be an array with at most 1000 entries.");
      const optionIds = new Set();
      for (const [optionIndex, option] of (Array.isArray(property.options) ? property.options : []).entries()) {
        if (!plain(option) || !identifier(option.id) || optionIds.has(option.id) || !name(option.name) || !COLORS.includes(option.color)) add(`${path}.options[${optionIndex}]`, "Options require a unique ID, a name, and a supported color.");
        optionIds.add(option?.id);
      }
      propertyMap.set(property.id, property);
    }
    function validPropertyValue(value, property) {
      if (value === null || value === "") return true;
      if (property.type === "text") return typeof value === "string" && value.length <= 20000;
      if (property.type === "number") return typeof value === "number" && Number.isFinite(value);
      if (property.type === "checkbox") return typeof value === "boolean";
      const options = new Set((Array.isArray(property.options) ? property.options : []).filter(Boolean).map((option) => option.id));
      if (property.type === "select") return typeof value === "string" && options.has(value);
      if (property.type === "multi_select") return Array.isArray(value) && value.length <= 1000 && new Set(value).size === value.length && value.every((id) => options.has(id));
      if (property.type === "date") return plain(value) && typeof value.includeTime === "boolean" && validDate(value.start, value.includeTime) && (value.end === "" || (validDate(value.end, value.includeTime) && value.end >= value.start));
      return false;
    }
    function validGroupKey(value, property) {
      if (value === null) return true;
      if (property.type === "text") return typeof value === "string" && value.length > 0 && value.length <= 20000;
      if (property.type === "number") return typeof value === "number" && Number.isFinite(value);
      if (property.type === "checkbox") return typeof value === "boolean";
      if (property.type === "date") return validDate(value, false);
      // Retain saved order when an option or relation target is removed.
      if (property.type === "select" || property.type === "multi_select") return identifier(value);
      return false;
    }
    for (const [index, resource] of (Array.isArray(state?.resources) ? state.resources : []).entries()) {
      if (resource?.propertyValues === undefined) continue;
      const path = `state.resources[${index}].propertyValues`;
      if (!plain(resource.propertyValues)) { add(path, "Property values must be an object."); continue; }
      for (const [id, value] of Object.entries(resource.propertyValues)) {
        const property = propertyMap.get(id);
        if (!property || BUILTIN_IDS.has(id) || !validPropertyValue(value, property)) add(`${path}.${id}`, "Value does not match an existing custom property's type and options.");
      }
    }
    if (views !== undefined && (!Array.isArray(views) || !views.length || views.length > 100)) add("state.settings.resourceViews", "Views must be a non-empty array with at most 100 entries.");
    const viewIds = new Set();
    function validateFilter(filter, path, ids, counter, depth = 0) {
      if (!plain(filter) || depth > MAX_FILTER_DEPTH || ++counter.count > 1000) { add(path, "Filter must be an object, at most 16 levels deep and 1000 conditions."); return; }
      if (!identifier(filter.id) || ids.has(filter.id)) add(`${path}.id`, "Filter IDs must be unique within their view.");
      ids.add(filter.id);
      if (own(filter, "rules")) {
        if (!["and", "or"].includes(filter.op) || !Array.isArray(filter.rules)) { add(path, "Filter groups require and/or plus an array of rules."); return; }
        filter.rules.slice(0, 1001).forEach((rule, index) => validateFilter(rule, `${path}.rules[${index}]`, ids, counter, depth + 1));
        return;
      }
      const property = propertyMap.get(filter.propertyId);
      if (!property || !filterOperators(property.type).some((operator) => operator.id === filter.operator)) { add(path, "Filter property or operator is invalid."); return; }
      const value = filter.value;
      if (filter.operator.startsWith("is_empty") || filter.operator === "is_not_empty" || value === "" || value === null || value === undefined) return;
      if (property.type === "date") {
        if (filter.operator === "relative") {
          if (!plain(value) || !RELATIVE_PERIODS.has(value.period) || (["past_days", "next_days"].includes(value.period) && (!Number.isInteger(value.days) || value.days < 1 || value.days > 36500))) add(`${path}.value`, "Relative dates require a supported period and a positive day count.");
        } else if (filter.operator === "between") {
          if (!plain(value) || (value.start !== "" && !validDate(value.start)) || (value.end !== "" && !validDate(value.end)) || (value.start && value.end && value.start > value.end)) add(`${path}.value`, "Date range must use valid, ordered dates.");
        } else if (!validDate(value)) add(`${path}.value`, "Date comparison requires a valid date.");
      } else if (property.type === "number") {
        const numeric = (entry) => entry === "" || entry === null || (typeof entry === "number" && Number.isFinite(entry));
        if (filter.operator === "between" ? !plain(value) || !numeric(value.start) || !numeric(value.end) || (!empty(value.start) && !empty(value.end) && value.start > value.end) : !numeric(value)) add(`${path}.value`, "Number comparison requires finite numbers.");
      } else if (property.type === "checkbox") {
        if (typeof value !== "boolean") add(`${path}.value`, "Checkbox comparison requires a boolean.");
      } else if (property.type === "text") {
        if (typeof value !== "string" || value.length > 20000) add(`${path}.value`, "Text comparison requires a string.");
      } else {
        // Deleted relation targets remain valid saved filter values, yielding no matches.
        if (!(Array.isArray(value) ? value.length <= 1000 && value.every(identifier) : identifier(value))) add(`${path}.value`, "Choice comparisons require option identifiers.");
      }
    }
    for (const [index, view] of (Array.isArray(views) ? views : []).entries()) {
      const path = `state.settings.resourceViews[${index}]`;
      if (!plain(view)) { add(path, "View must be an object."); continue; }
      if (!identifier(view.id) || viewIds.has(view.id)) add(`${path}.id`, "View ID must be unique.");
      viewIds.add(view.id);
      if (!name(view.name)) add(`${path}.name`, "View name must contain 1 to 200 characters.");
      if (!["list", "table"].includes(view.layout)) add(`${path}.layout`, "View layout must be list or table.");
      if (!plain(view.filter) || !Array.isArray(view.filter.rules)) add(`${path}.filter`, "The root filter must be an AND/OR group.");
      validateFilter(view.filter, `${path}.filter`, new Set(), { count: 0 });
      for (const key of ["sorts", "groups"]) {
        if (!Array.isArray(view[key]) || view[key].length > 100) { add(`${path}.${key}`, "View ordering must be an array with at most 100 entries."); continue; }
        const ids = new Set();
        for (const [orderIndex, order] of view[key].entries()) {
          const orderPath = `${path}.${key}[${orderIndex}]`;
          const property = propertyMap.get(order?.propertyId);
          const directions = key === "groups" ? ["asc", "desc", "custom"] : ["asc", "desc"];
          if (!plain(order) || !identifier(order.id) || ids.has(order.id) || !property || !directions.includes(order.direction)) add(orderPath, `Ordering requires a unique ID, an existing property, and ${directions.join("/")} direction.`);
          if (key === "groups" && (order?.direction === "custom" || own(order, "customOrder"))) {
            const values = order?.customOrder;
            if (!Array.isArray(values) || values.length > MAX_GROUP_ORDER_KEYS || new Set(values).size !== values.length || (property && !Array.from(values).every((value) => validGroupKey(value, property)))) add(`${orderPath}.customOrder`, `Custom group order requires at most ${MAX_GROUP_ORDER_KEYS} unique keys matching the property's type.`);
          }
          ids.add(order?.id);
        }
      }
      if (!Array.isArray(view.visibleProperties) || new Set(view.visibleProperties).size !== view.visibleProperties.length || !view.visibleProperties.every((id) => propertyMap.has(id))) add(`${path}.visibleProperties`, "Visible properties must be unique existing property IDs.");
    }
    const active = state?.settings?.activeResourceViewId;
    if (active !== undefined && (!identifier(active) || (views !== undefined && !viewIds.has(active)))) add("state.settings.activeResourceViewId", "Active Resource view must exist.");
    return issues;
  }

  scope.SYGMAResourceModel = Object.freeze({ PROPERTY_TYPES, COLORS, MAX_FILTER_DEPTH, MAX_GROUP_ORDER_KEYS, normalizeSettings, getProperties, getValue, filterOperators, matchesFilter, applyView, compareValues, groupValueKeys, orderGroupKeys, displayValue, validateState });
})(globalThis);

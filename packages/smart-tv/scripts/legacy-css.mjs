// Adds fallbacks to the built CSS for Chromium 87 (webOS 22), which drops any
// rule using `:is()` or `:where()` and lacks `aspect-ratio` and `overflow: clip`.
// The fallbacks sit in `@supports not` blocks, so newer engines skip them.
import postcss from 'postcss';
import parser from 'postcss-selector-parser';

const LISTS = new Set([':is', ':where', ':-webkit-any']);
const NO_IS = 'not selector(:is(a))';
const NO_ASPECT = 'not (aspect-ratio: 1)';
// `:where()` adds nothing to specificity, which a plain selector can't match.
// @tailwindcss/forms relies on it to lose to utilities; the app styles its
// controls itself, so those rules are left out rather than made to win.
const FORMS = /^(input|select|textarea|\.form-[\w-]+):where\(/;
// A `:where(:not(...))` filter only narrows; dropping it keeps the specificity.
const WHERE_NOT = /:where\(:not\([^()]*\)\)/g;

function firstList(selector) {
  let found = null;
  selector.walkPseudos((p) => {
    if (!found && LISTS.has(p.value)) found = p;
  });
  return found;
}

/** The selector without its first, top-level `:is()`/`:where()`, one per argument. */
function expandTop(text) {
  const parse = () => parser().astSync(text).first;
  const target = firstList(parse());
  return target.nodes.map((_, index) => {
    const selector = parse();
    const pseudo = firstList(selector);
    const arg = pseudo.nodes[index];
    const nodes = arg.nodes.slice();
    // An argument with combinators keeps its last compound in place and the
    // rest in front of the whole selector.
    let cut = -1;
    nodes.forEach((n, i) => {
      if (n.type === 'combinator') cut = i;
    });
    const prefix =
      cut >= 0
        ? nodes
            .slice(0, cut + 1)
            .join('')
            .trim()
        : '';
    let compound = nodes.slice(cut + 1).map(String);
    const siblings = pseudo.parent.nodes;
    let start = siblings.indexOf(pseudo);
    while (start > 0 && siblings[start - 1].type !== 'combinator') start--;
    const first = nodes[cut + 1];
    if (first && start !== siblings.indexOf(pseudo)) {
      if (first.type === 'universal') compound = compound.slice(1);
      else if (first.type === 'tag') {
        // A type selector must lead its compound.
        compound = compound.slice(1);
        siblings[start].parent.insertBefore(
          siblings[start],
          parser.tag({ value: String(first).trim() })
        );
      }
    }
    pseudo.replaceWith(parser.string({ value: compound.join('').trim() }));
    const rest = String(selector).trim();
    return prefix ? `${prefix} ${rest}` : rest;
  });
}

/** Every plain selector the selector stands for, or none it can't be written as. */
function expand(text, depth = 0) {
  if (depth > 6) return [];
  const once = expandOnce(text);
  if (once === null) return [text];
  return once.flatMap((t) => expand(t, depth + 1));
}

/** Null when nothing is left to expand. */
function expandOnce(text) {
  try {
    const selector = parser().astSync(text).first;
    const target = firstList(selector);
    if (!target) return null;
    const host = target.parent.parent;
    if (host.type === 'pseudo') {
      // :not(:is(a, b)) is :not(a):not(b), when a and b are compounds.
      if (
        host.value !== ':not' ||
        host.nodes.length !== 1 ||
        target.parent.nodes.length !== 1 ||
        target.nodes.some((arg) =>
          arg.nodes.some((n) => n.type === 'combinator')
        )
      )
        return [];
      const chain = target.nodes
        .map((arg) => `:not(${String(arg).trim()})`)
        .join('');
      host.replaceWith(parser.string({ value: chain }));
      return [String(selector).trim()];
    }
    return expandTop(text);
  } catch {
    return [];
  }
}

function valid(text) {
  try {
    const selector = parser().astSync(text);
    let modern = false;
    selector.walkPseudos((p) => {
      if (LISTS.has(p.value) || p.value === ':has') modern = true;
    });
    return !modern;
  } catch {
    return false;
  }
}

function wrap(params, rule) {
  const block = postcss.atRule({ name: 'supports', params });
  block.append(rule);
  return block;
}

function aspectPadding(value) {
  const [w, h = '1'] = value.split('/').map((s) => parseFloat(s));
  return w > 0 && h > 0 ? `${+((h / w) * 100).toFixed(4)}%` : null;
}

export function legacyCss(css) {
  const root = postcss.parse(css);
  let rules = 0;
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && rule.parent.name === 'supports')
      if (rule.parent.params === NO_IS || rule.parent.params === NO_ASPECT)
        return;
    // overflow: clip is overflow: hidden without a scroll container.
    rule.walkDecls(/^overflow(-x|-y)?$/, (decl) => {
      if (decl.value === 'clip') decl.cloneBefore({ value: 'hidden' });
    });
    if (rule.selectors.some((s) => /:(is|where)\(/.test(s))) {
      const selectors = [
        ...new Set(
          rule.selectors
            .filter((s) => !FORMS.test(s))
            .map((s) => s.replace(WHERE_NOT, ''))
            .flatMap((s) => expand(s))
            .filter(valid)
        ),
      ];
      if (selectors.length) {
        rule.after(wrap(NO_IS, rule.clone({ selectors })));
        rules++;
      }
    }
    // A pseudo-element's height from its width; elements get theirs from legacy.js.
    if (rule.selectors.every((s) => /::?(before|after)$/.test(s)))
      rule.walkDecls('aspect-ratio', (decl) => {
        const padding = aspectPadding(decl.value);
        if (padding)
          rule.after(
            wrap(
              NO_ASPECT,
              postcss.rule({
                selector: rule.selector,
                nodes: [postcss.decl({ prop: 'padding-top', value: padding })],
              })
            )
          );
      });
  });
  return { css: root.toString(), rules };
}

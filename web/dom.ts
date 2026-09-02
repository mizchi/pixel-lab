export interface UiNode {
  textContent: string | null;
}

export interface UiText extends UiNode {
  data: string;
}

export interface UiContainer extends UiNode {
  appendChild<T extends UiNode>(child: T): T;
}

export interface UiElement extends UiContainer {
  setAttribute(name: string, value: string): void;
}

export interface UiDocument {
  createElement(tagName: string): UiElement;
  createTextNode(data: string): UiText;
}

export class UiSignal<T> {
  #value: T;
  readonly #subscribers = new Set<() => void>();

  constructor(value: T) {
    this.#value = value;
  }

  get value(): T {
    return this.#value;
  }

  set value(next: T) {
    if (Object.is(this.#value, next)) return;
    this.#value = next;
    for (const subscriber of this.#subscribers) subscriber();
  }

  subscribe(subscriber: () => void): void {
    this.#subscribers.add(subscriber);
  }
}

export type UiChild = UiNode | string | number | null | undefined;

/** Minimal demo-only DOM binding; the physics packages do not depend on a UI runtime. */
export class SimdUi {
  readonly #document: UiDocument;

  constructor(options: { readonly document: UiDocument }) {
    this.#document = options.document;
  }

  signal<T>(value: T): UiSignal<T> {
    return new UiSignal(value);
  }

  text(
    dependencies: readonly UiSignal<unknown>[],
    render: () => string,
  ): UiText {
    const node = this.#document.createTextNode(render());
    const update = () => node.data = render();
    for (const dependency of dependencies) dependency.subscribe(update);
    return node;
  }

  element(
    tagName: string,
    properties: Readonly<Record<string, unknown>>,
    children: readonly UiChild[] = [],
  ): UiElement {
    const element = this.#document.createElement(tagName);
    for (const [name, value] of Object.entries(properties)) {
      if (value === undefined || value === null || value === false) continue;
      const property = name === "ariaLabel" ? "aria-label" : name;
      if (name === "className") element.setAttribute("class", String(value));
      else if (property in element) {
        (element as unknown as Record<string, unknown>)[property] = value;
      } else {element.setAttribute(
          property,
          value === true ? "" : String(value),
        );}
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      element.appendChild(
        typeof child === "string" || typeof child === "number"
          ? this.#document.createTextNode(String(child))
          : child,
      );
    }
    return element;
  }

  async mount(container: UiContainer, root: UiNode): Promise<void> {
    container.textContent = "";
    container.appendChild(root);
  }
}

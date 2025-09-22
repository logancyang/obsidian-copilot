import { DecoratorNode, NodeKey } from "lexical";
import { IPillNode } from "./PillDeletionPlugin";

/**
 * Abstract base class for all pill nodes that provides common pill behaviors.
 * This ensures consistent cursor navigation and interaction across all pill types.
 */
export abstract class BasePillNode extends DecoratorNode<JSX.Element> implements IPillNode {
  constructor(key?: NodeKey) {
    super(key);
  }

  /**
   * Pills are decorator nodes that don't need DOM updates.
   */
  updateDOM(): false {
    return false;
  }

  /**
   * Pills are inline elements that flow with text.
   */
  isInline(): boolean {
    return true;
  }

  /**
   * Allow cursor to be placed before the pill.
   */
  canInsertTextBefore(): boolean {
    return true;
  }

  /**
   * Allow cursor to be placed after the pill.
   */
  canInsertTextAfter(): boolean {
    return true;
  }

  /**
   * Pills cannot be empty.
   */
  canBeEmpty(): boolean {
    return false;
  }

  /**
   * Pills can be selected with keyboard navigation.
   */
  isKeyboardSelectable(): boolean {
    return true;
  }

  /**
   * Pills are treated as isolated units for selection and deletion.
   */
  isIsolated(): boolean {
    return true;
  }

  /**
   * Identifies this node as a pill for the deletion plugin.
   */
  isPill(): boolean {
    return true;
  }

  // Abstract methods that subclasses must implement

  /**
   * Returns the React component to render for this pill.
   */
  abstract decorate(): JSX.Element;

  /**
   * Returns the text content representation of this pill.
   */
  abstract getTextContent(): string;
}

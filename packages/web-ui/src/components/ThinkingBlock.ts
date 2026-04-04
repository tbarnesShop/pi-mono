import { icon } from "@mariozechner/mini-lit";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ChevronRight } from "lucide";

@customElement("thinking-block")
export class ThinkingBlock extends LitElement {
	@property() content!: string;
	@property({ type: Boolean }) isStreaming = false;
	@state() private isExpanded = false;

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this;
	}

	override connectedCallback(): void {
		super.connectedCallback();
		this.style.display = "block";
	}

	private toggleExpanded() {
		this.isExpanded = !this.isExpanded;
	}

	override render() {
		const shimmerClasses = this.isStreaming
			? "animate-shimmer bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent"
			: "";

		return html`
			<div class="thinking-block mx-4 rounded-xl border border-border bg-card/80 px-4 py-3 shadow-xs">
				<button
					type="button"
					class="flex w-full items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
					aria-expanded=${this.isExpanded ? "true" : "false"}
					@click=${this.toggleExpanded}
				>
					<span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform ${this.isExpanded ? "rotate-90" : ""}">${icon(ChevronRight, "sm")}</span>
					<span class="text-[11px] font-semibold uppercase tracking-[0.18em]">Thinking</span>
					<span class="${shimmerClasses} text-[11px] uppercase tracking-[0.18em]">${this.isStreaming ? "streaming" : this.isExpanded ? "expanded" : "collapsed"}</span>
				</button>
				${
					this.isExpanded
						? html`
							<div class="mt-3 rounded-lg border border-border bg-background/80 p-3 text-sm leading-relaxed text-foreground">
								<markdown-block .content=${this.content} .isThinking=${true}></markdown-block>
							</div>
						`
						: ""
				}
			</div>
		`;
	}
}

/* nc-* custom elements — tell TypeScript these are valid JSX tags */
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      'nc-chat-ui-app-provider': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

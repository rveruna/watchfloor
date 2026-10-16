/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "server" to talk to the mock server over HTTP and a websocket; anything else runs the in-page demo. */
  readonly VITE_API_MODE?: string;
}

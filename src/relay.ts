/**
 * @fileoverview Bootstrap/relay node startup.
 *
 * Wraps `createRelay` from `@peerkit/transport-libp2p-nodejs`. A relay handles
 * the access and agents protocols and acts as a circuit-relay-v2 server, so
 * peers behind NAT can be reached and discovered. STUB: the access handler
 * admits any peer whose presented bytes match the network secret; agent-info
 * is logged and dropped.
 */

import { createRelay } from "@peerkit/transport-libp2p-nodejs";
import type { NetworkAccessBytes, NodeId } from "@peerkit/api";
import type { RelayConfig } from "./config.js";
import { bytesEqual, computeNetworkAccessBytes } from "./network-access.js";

/**
 * Start a bootstrap/relay node from `config`.
 *
 * Resolves once the libp2p node has started and is accepting connections.
 */
export async function startRelay(config: RelayConfig): Promise<void> {
  const networkAccessBytes = computeNetworkAccessBytes(config.networkSecret);

  const networkAccessHandler = async (
    nodeId: NodeId,
    bytes: NetworkAccessBytes,
  ): Promise<boolean> => {
    const granted = bytesEqual(bytes, networkAccessBytes);
    console.log(`[access] ${nodeId} ${granted ? "granted" : "denied"}`);
    return granted;
  };

  const transport = await createRelay({
    id: config.id,
    addrs: [...config.listenAddrs],
    networkAccessBytes,
    networkAccessHandler,
    peerConnectedCallback: (nodeId: NodeId): void => {
      console.log(`[peer] connected ${nodeId}`);
    },
    agentsReceivedCallback: async (
      fromNode: NodeId,
      agentBytes: Uint8Array,
    ): Promise<void> => {
      // STUB: a real relay may persist or forward agent-info. Here we only log.
      console.log(`[agents] ${fromNode} sent ${agentBytes.length} bytes`);
    },
  });

  console.log(`[relay] ${config.id} started`, transport);
}

declare module "wrtc" {
  export const RTCPeerConnection: typeof globalThis.RTCPeerConnection
  export const RTCSessionDescription: typeof globalThis.RTCSessionDescription
  export const RTCIceCandidate: typeof globalThis.RTCIceCandidate
  const wrtc: {
    RTCPeerConnection: typeof globalThis.RTCPeerConnection
    RTCSessionDescription: typeof globalThis.RTCSessionDescription
    RTCIceCandidate: typeof globalThis.RTCIceCandidate
  }
  export default wrtc
}

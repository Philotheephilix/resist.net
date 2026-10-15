// Volunteer proxy side
// Creates a WebRTC peer, publishes SDP offer to Arkiv with TTL=5min
// Accepts incoming connections from censored users

const OFFER_TTL_SECONDS = 5 * 60; // 5 minutes — auto-expires if node goes offline

export async function startVolunteer(wallet: string, geohash: string) {
  // TODO: replace stubs with real WebRTC (wrtc / browser RTCPeerConnection)
  const sdpOffer = JSON.stringify({ type: "offer", sdp: "v=0\r\n..." }); // stub

  // Publish offer to Arkiv with TTL
  // await arkiv.entity("VolunteerProxy").create({
  //   wallet,
  //   sdpOffer,
  //   geohash,
  //   capacitySlots: 5,
  //   createdAt: Date.now(),
  //   ttl: OFFER_TTL_SECONDS,
  // });

  // Refresh TTL every 4 minutes while alive
  setInterval(async () => {
    // await arkiv.entity("VolunteerProxy").update(wallet, { ttl: OFFER_TTL_SECONDS });
  }, 4 * 60 * 1000);

  console.log(`Volunteer proxy active. Wallet: ${wallet} Geohash: ${geohash}`);
}

let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function getIO() {
  return ioInstance;
}

export function emitAll(eventName, payload) {
  if (!ioInstance) return;
  ioInstance.emit(eventName, payload);
}

export function emitTo(roomName, eventName, payload) {
  if (!ioInstance) return;
  ioInstance.to(roomName).emit(eventName, payload);
}

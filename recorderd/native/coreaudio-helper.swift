import Foundation
import CoreAudio
import AudioToolbox

let audioSystemObjectID = AudioObjectID(kAudioObjectSystemObject)

enum HelperError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let value):
            return value
        }
    }
}

struct DeviceInfo {
    let id: String
    let backend: String
    let name: String
    let inputChannels: Int
    let sampleRates: [Int]
    let defaultSampleRate: Int
    let isDefault: Bool

    var jsonObject: [String: Any] {
        [
            "id": id,
            "backend": backend,
            "name": name,
            "inputChannels": inputChannels,
            "sampleRates": sampleRates,
            "defaultSampleRate": defaultSampleRate,
            "isDefault": isDefault
        ]
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func checkStatus(_ status: OSStatus, _ message: String) throws {
    if status != noErr {
        throw HelperError.message("\(message) (status \(status))")
    }
}

func propertyAddress(
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
    element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain
) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: element
    )
}

func stringProperty(
    objectID: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) throws -> String {
    var address = propertyAddress(selector: selector, scope: scope)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)

    try withUnsafeMutablePointer(to: &value) { pointer in
        try checkStatus(
            AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, pointer),
            "Unable to read string property."
        )
    }

    return value as String
}

func numericProperty<T>(
    objectID: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal,
    defaultValue: T
) throws -> T {
    var address = propertyAddress(selector: selector, scope: scope)
    var value = defaultValue
    var size = UInt32(MemoryLayout<T>.size)

    try withUnsafeMutablePointer(to: &value) { pointer in
        try checkStatus(
            AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, pointer),
            "Unable to read numeric property."
        )
    }

    return value
}

func readAudioDevices() throws -> [AudioObjectID] {
    var address = propertyAddress(selector: kAudioHardwarePropertyDevices)
    var size: UInt32 = 0

    try checkStatus(
        AudioObjectGetPropertyDataSize(audioSystemObjectID, &address, 0, nil, &size),
        "Unable to get audio device list size."
    )

    let count = Int(size) / MemoryLayout<AudioObjectID>.stride
    var devices = Array(repeating: AudioObjectID(0), count: count)

    try checkStatus(
        AudioObjectGetPropertyData(audioSystemObjectID, &address, 0, nil, &size, &devices),
        "Unable to read audio device list."
    )

    return devices
}

func readInputChannelCount(deviceID: AudioObjectID) throws -> Int {
    var address = propertyAddress(
        selector: kAudioDevicePropertyStreamConfiguration,
        scope: kAudioDevicePropertyScopeInput
    )
    var size: UInt32 = 0

    try checkStatus(
        AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size),
        "Unable to get stream configuration size."
    )

    let buffer = UnsafeMutableRawPointer.allocate(
        byteCount: Int(size),
        alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer {
        buffer.deallocate()
    }

    try checkStatus(
        AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, buffer),
        "Unable to read stream configuration."
    )

    let bufferList = buffer.assumingMemoryBound(to: AudioBufferList.self)
    let audioBuffers = UnsafeMutableAudioBufferListPointer(bufferList)

    return audioBuffers.reduce(0) { partial, item in
        partial + Int(item.mNumberChannels)
    }
}

func readSampleRates(deviceID: AudioObjectID) throws -> [Int] {
    var rates: Set<Int> = []
    var address = propertyAddress(selector: kAudioDevicePropertyAvailableNominalSampleRates)
    var size: UInt32 = 0

    let sizeStatus = AudioObjectGetPropertyDataSize(deviceID, &address, 0, nil, &size)

    if sizeStatus == noErr, size > 0 {
        let count = Int(size) / MemoryLayout<AudioValueRange>.stride
        let buffer = UnsafeMutablePointer<AudioValueRange>.allocate(capacity: count)
        defer {
            buffer.deallocate()
        }

        try checkStatus(
            AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, buffer),
            "Unable to read available sample rates."
        )

        let preferredRates: [Double] = [44100, 48000, 88200, 96000]

        for index in 0..<count {
          let range = buffer[index]

          for candidate in preferredRates where candidate >= range.mMinimum && candidate <= range.mMaximum {
            rates.insert(Int(candidate))
          }
        }
    }

    if rates.isEmpty {
        let currentRate: Float64 = try numericProperty(
            objectID: deviceID,
            selector: kAudioDevicePropertyNominalSampleRate,
            defaultValue: 48000.0
        )
        rates.insert(Int(currentRate.rounded()))
    }

    return Array(rates).sorted()
}

func readDefaultInputDeviceID() throws -> AudioObjectID {
    try numericProperty(
        objectID: audioSystemObjectID,
        selector: kAudioHardwarePropertyDefaultInputDevice,
        defaultValue: AudioObjectID(0)
    )
}

func listDevices() throws -> [DeviceInfo] {
    let defaultInputDevice = try readDefaultInputDeviceID()

    return try readAudioDevices().compactMap { deviceID in
        let inputChannels = try readInputChannelCount(deviceID: deviceID)

        if inputChannels <= 0 {
            return nil
        }

        let identifier = try stringProperty(objectID: deviceID, selector: kAudioDevicePropertyDeviceUID)
        let name = try stringProperty(objectID: deviceID, selector: kAudioObjectPropertyName)
        let sampleRates = try readSampleRates(deviceID: deviceID)

        return DeviceInfo(
            id: identifier,
            backend: "coreaudio",
            name: name,
            inputChannels: inputChannels,
            sampleRates: sampleRates,
            defaultSampleRate: sampleRates.first ?? 48000,
            isDefault: deviceID == defaultInputDevice
        )
    }
}

func writeBlock(frameCount: Int, channelCount: Int, audioData: UnsafeRawPointer, byteCount: Int) {
    var header = Data(count: 12)

    header.withUnsafeMutableBytes { rawBuffer in
        guard let baseAddress = rawBuffer.baseAddress else {
            return
        }

        baseAddress.storeBytes(of: UInt32(8 + byteCount).littleEndian, as: UInt32.self)
        baseAddress.advanced(by: 4).storeBytes(of: UInt32(frameCount).littleEndian, as: UInt32.self)
        baseAddress.advanced(by: 8).storeBytes(of: UInt16(channelCount).littleEndian, as: UInt16.self)
        baseAddress.advanced(by: 10).storeBytes(of: UInt16(1).littleEndian, as: UInt16.self)
    }

    FileHandle.standardOutput.write(header)
    FileHandle.standardOutput.write(Data(bytes: audioData, count: byteCount))
}

final class CaptureContext {
    let deviceID: String
    let sampleRate: Double
    let channelCount: UInt32
    let framesPerBuffer: UInt32
    let bytesPerFrame: UInt32
    var queue: AudioQueueRef?
    var isStopping = false
    var signalSources: [DispatchSourceSignal] = []

    init(deviceID: String, sampleRate: Double, channelCount: UInt32, framesPerBuffer: UInt32) {
        self.deviceID = deviceID
        self.sampleRate = sampleRate
        self.channelCount = channelCount
        self.framesPerBuffer = framesPerBuffer
        self.bytesPerFrame = channelCount * UInt32(MemoryLayout<Float32>.size)
    }

    func installSignalHandlers() {
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)

        let signals = [SIGINT, SIGTERM].map { signalNumber in
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in
                self?.stop()
            }
            source.resume()
            return source
        }

        self.signalSources = signals
    }

    func run() throws {
        installSignalHandlers()

        var format = AudioStreamBasicDescription(
            mSampleRate: sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: bytesPerFrame,
            mFramesPerPacket: 1,
            mBytesPerFrame: bytesPerFrame,
            mChannelsPerFrame: channelCount,
            mBitsPerChannel: 32,
            mReserved: 0
        )

        let callback: AudioQueueInputCallback = { userData, queueRef, bufferRef, _, _, _ in
            guard let userData else {
                return
            }

            let context = Unmanaged<CaptureContext>.fromOpaque(userData).takeUnretainedValue()
            let byteCount = Int(bufferRef.pointee.mAudioDataByteSize)

            if byteCount > 0 {
                let audioPointer = bufferRef.pointee.mAudioData
                let frameCount = byteCount / Int(context.bytesPerFrame)
                writeBlock(
                    frameCount: frameCount,
                    channelCount: Int(context.channelCount),
                    audioData: audioPointer,
                    byteCount: byteCount
                )
            }

            if !context.isStopping {
                AudioQueueEnqueueBuffer(queueRef, bufferRef, 0, nil)
            }
        }

        var queueRef: AudioQueueRef?

        try checkStatus(
            AudioQueueNewInput(
                &format,
                callback,
                Unmanaged.passUnretained(self).toOpaque(),
                nil,
                nil,
                0,
                &queueRef
            ),
            "Unable to create CoreAudio input queue."
        )

        guard let queueRef else {
            throw HelperError.message("Audio queue could not be created.")
        }

        self.queue = queueRef

        var deviceUID = deviceID as CFString
        let devicePropertySize = UInt32(MemoryLayout<CFString>.size)

        try withUnsafePointer(to: &deviceUID) { pointer in
            try checkStatus(
                AudioQueueSetProperty(queueRef, kAudioQueueProperty_CurrentDevice, pointer, devicePropertySize),
                "Unable to select the requested CoreAudio input device."
            )
        }

        let bufferByteSize = framesPerBuffer * bytesPerFrame

        for _ in 0..<3 {
            var bufferRef: AudioQueueBufferRef?

            try checkStatus(
                AudioQueueAllocateBuffer(queueRef, bufferByteSize, &bufferRef),
                "Unable to allocate CoreAudio input buffer."
            )

            guard let bufferRef else {
                throw HelperError.message("Audio queue buffer allocation failed.")
            }

            bufferRef.pointee.mAudioDataByteSize = bufferByteSize

            try checkStatus(
                AudioQueueEnqueueBuffer(queueRef, bufferRef, 0, nil),
                "Unable to enqueue CoreAudio input buffer."
            )
        }

        try checkStatus(
            AudioQueueStart(queueRef, nil),
            "Unable to start CoreAudio input queue."
        )

        while !isStopping && RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.25)) {
        }
    }

    func stop() {
        if isStopping {
            return
        }

        isStopping = true

        if let queue {
            AudioQueueStop(queue, true)
            AudioQueueDispose(queue, true)
            self.queue = nil
        }
    }
}

func parseFlag(_ name: String, arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else {
        return nil
    }

    return arguments[index + 1]
}

func runListDevicesCommand() throws {
    let devices = try listDevices()
    let payload = devices.map(\.jsonObject)
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted])

    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func runCaptureCommand(arguments: [String]) throws {
    guard let deviceID = parseFlag("--device-id", arguments: arguments), !deviceID.isEmpty else {
        throw HelperError.message("Missing --device-id.")
    }

    guard
        let sampleRateRaw = parseFlag("--sample-rate", arguments: arguments),
        let sampleRate = Double(sampleRateRaw)
    else {
        throw HelperError.message("Missing or invalid --sample-rate.")
    }

    guard
        let channelsRaw = parseFlag("--channels", arguments: arguments),
        let channels = UInt32(channelsRaw),
        channels > 0
    else {
        throw HelperError.message("Missing or invalid --channels.")
    }

    let framesPerBuffer = UInt32(parseFlag("--frames-per-buffer", arguments: arguments).flatMap(UInt32.init) ?? 1024)
    let capture = CaptureContext(
        deviceID: deviceID,
        sampleRate: sampleRate,
        channelCount: channels,
        framesPerBuffer: max(256, framesPerBuffer)
    )

    try capture.run()
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())

    guard let command = arguments.first else {
        throw HelperError.message("Missing command. Expected list-devices or capture.")
    }

    switch command {
    case "list-devices":
        try runListDevicesCommand()
    case "capture":
        try runCaptureCommand(arguments: Array(arguments.dropFirst()))
    default:
        throw HelperError.message("Unsupported command: \(command)")
    }
} catch {
    fail(String(describing: error))
}

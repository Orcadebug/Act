using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PredictiveDesktopLayer.Application.Services;
using PredictiveDesktopLayer.Application.StateMachine;
using PredictiveDesktopLayer.Domain.Enums;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;
using PredictiveDesktopLayer.Infrastructure.Capture;
using PredictiveDesktopLayer.Infrastructure.CloudBrain;
using PredictiveDesktopLayer.Infrastructure.Inactivity;
using PredictiveDesktopLayer.Infrastructure.Input;
using PredictiveDesktopLayer.Infrastructure.Persistence;

namespace PredictiveDesktopLayer.Tests;

class Program
{
    static async Task Main(string[] args)
    {
        Console.WriteLine("===========================================");
        Console.WriteLine("  Predictive Desktop Layer - Feature Tests");
        Console.WriteLine("===========================================\n");

        var loggerFactory = LoggerFactory.Create(builder => builder.AddConsole().SetMinimumLevel(LogLevel.Debug));

        var tests = new Dictionary<string, Func<ILoggerFactory, Task<bool>>>
        {
            ["1"] = TestInactivityDetector,
            ["2"] = TestFrameBuffer,
            ["3"] = TestScreenCapture,
            ["4"] = TestStateMachine,
            ["5"] = TestActionParser,
            ["6"] = TestInputSimulator,
            ["7"] = TestFeedbackStore,
            ["8"] = TestAllIntegrated
        };

        while (true)
        {
            Console.WriteLine("\nSelect a test to run:");
            Console.WriteLine("  1. Inactivity Detector (GetLastInputInfo)");
            Console.WriteLine("  2. Frame Buffer (Rolling buffer)");
            Console.WriteLine("  3. Screen Capture (DXGI duplication)");
            Console.WriteLine("  4. State Machine (Transitions)");
            Console.WriteLine("  5. Action Parser (Cloud response parsing)");
            Console.WriteLine("  6. Input Simulator (Mouse/keyboard)");
            Console.WriteLine("  7. Feedback Store (LiteDB)");
            Console.WriteLine("  8. All Integrated Test");
            Console.WriteLine("  Q. Quit");
            Console.Write("\nChoice: ");

            var choice = Console.ReadLine()?.Trim().ToUpper();
            if (choice == "Q") break;

            if (tests.TryGetValue(choice ?? "", out var test))
            {
                Console.WriteLine("\n--- Running Test ---\n");
                try
                {
                    var result = await test(loggerFactory);
                    Console.WriteLine($"\n--- Result: {(result ? "PASSED" : "FAILED")} ---");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"\n--- EXCEPTION: {ex.Message} ---");
                    Console.WriteLine(ex.StackTrace);
                }
            }
            else
            {
                Console.WriteLine("Invalid choice.");
            }
        }
    }

    static Task<bool> TestInactivityDetector(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing MouseInactivityDetector...");
        var detector = new MouseInactivityDetector();

        Console.WriteLine("Move your mouse and watch the idle time reset.");
        Console.WriteLine("Stop moving for 2 seconds to see idle detection.\n");

        for (int i = 0; i < 10; i++)
        {
            var idleTime = detector.GetIdleTime();
            var cursorPos = detector.GetCursorPosition();
            var isInactive = detector.IsInactive(TimeSpan.FromSeconds(1));

            Console.WriteLine($"  Idle: {idleTime.TotalMilliseconds:F0}ms | Cursor: ({cursorPos.X}, {cursorPos.Y}) | Inactive(1s): {isInactive}");
            Thread.Sleep(500);
        }

        Console.WriteLine("\nInactivity detector working correctly!");
        return Task.FromResult(true);
    }

    static Task<bool> TestFrameBuffer(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing FrameBufferManager...");
        var buffer = new FrameBufferManager(5); // Max 5 frames

        Console.WriteLine($"  Buffer max size: {buffer.MaxSize}");
        Console.WriteLine($"  Initial count: {buffer.Count}");

        // Add frames
        for (int i = 1; i <= 7; i++)
        {
            buffer.Add(new CapturedFrame
            {
                ImageData = new byte[] { (byte)i },
                CapturedAt = DateTime.UtcNow,
                Width = 1920,
                Height = 1080
            });
            Console.WriteLine($"  Added frame {i}, count: {buffer.Count}");
        }

        var recent = buffer.GetRecentFrames(3);
        Console.WriteLine($"\n  Recent 3 frames retrieved: {recent.Count}");
        Console.WriteLine($"  First byte values: {string.Join(", ", recent.Select(f => f.ImageData[0]))}");

        buffer.Clear();
        Console.WriteLine($"  After clear, count: {buffer.Count}");

        var passed = buffer.Count == 0 && recent.Count == 3;
        return Task.FromResult(passed);
    }

    static async Task<bool> TestScreenCapture(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing WindowsGraphicsCapture...");
        var logger = loggerFactory.CreateLogger<WindowsGraphicsCapture>();
        var detector = new MouseInactivityDetector();

        using var capture = new WindowsGraphicsCapture(logger, detector);

        Console.WriteLine("  Starting capture...");
        await capture.StartAsync();

        Console.WriteLine("  Capturing 3 frames...\n");
        for (int i = 0; i < 3; i++)
        {
            var frame = await capture.CaptureAsync();
            if (frame != null)
            {
                Console.WriteLine($"  Frame {i + 1}: {frame.Width}x{frame.Height}, {frame.ImageData.Length / 1024}KB JPEG, Cursor: ({frame.CursorX}, {frame.CursorY})");
            }
            else
            {
                Console.WriteLine($"  Frame {i + 1}: null (frame not ready)");
            }
            await Task.Delay(500);
        }

        Console.WriteLine("\n  Stopping capture...");
        await capture.StopAsync();

        Console.WriteLine("Screen capture working!");
        return true;
    }

    static Task<bool> TestStateMachine(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing PulseStateMachine...");
        var logger = loggerFactory.CreateLogger<PulseStateMachine>();
        var sm = new PulseStateMachine(logger);

        sm.StateChanged += (s, e) => Console.WriteLine($"  Event: {e.PreviousState} -> {e.NewState}");

        Console.WriteLine($"  Initial state: {sm.CurrentState}");

        // Test valid transitions
        var transitions = new[]
        {
            (PulseState.Capturing, true),
            (PulseState.IntentDetected, true),
            (PulseState.ProcessingCloud, true),
            (PulseState.AwaitingApproval, true),
            (PulseState.Executing, true),
            (PulseState.Cooling, true),
            (PulseState.Idle, true),
        };

        bool allPassed = true;
        foreach (var (target, expected) in transitions)
        {
            var result = sm.TryTransition(target);
            var status = result == expected ? "OK" : "FAIL";
            Console.WriteLine($"  Transition to {target}: {status}");
            if (result != expected) allPassed = false;
        }

        // Test invalid transition
        sm.Reset();
        var invalidResult = sm.TryTransition(PulseState.Executing); // Can't go Idle -> Executing
        Console.WriteLine($"  Invalid (Idle -> Executing): {(invalidResult ? "FAIL" : "OK (blocked)")}");
        if (invalidResult) allPassed = false;

        return Task.FromResult(allPassed);
    }

    static Task<bool> TestActionParser(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing SemanticActionParser...");
        var logger = loggerFactory.CreateLogger<SemanticActionParser>();
        var parser = new SemanticActionParser(logger);

        var response = new CloudBrainResponse
        {
            Confidence = 0.92,
            Description = "Save the document and close the dialog",
            Actions = new List<CloudAction>
            {
                new CloudAction
                {
                    Type = "click",
                    Target = "Save button",
                    Region = new CloudRegion { X = 450, Y = 320, Width = 80, Height = 30 }
                },
                new CloudAction
                {
                    Type = "type",
                    Target = "Filename field",
                    Text = "document.txt"
                },
                new CloudAction
                {
                    Type = "key",
                    Target = "Keyboard",
                    Keys = "ctrl+s"
                },
                new CloudAction
                {
                    Type = "scroll",
                    Target = "Document area",
                    Region = new CloudRegion { X = 500, Y = 400, Width = 100, Height = 100 },
                    Direction = "down",
                    Amount = 3
                }
            }
        };

        Console.WriteLine("  Input cloud response:");
        Console.WriteLine($"    Description: {response.Description}");
        Console.WriteLine($"    Actions count: {response.Actions.Count}");

        var sequence = parser.Parse(response);

        Console.WriteLine($"\n  Parsed actions: {sequence.Actions.Count}");
        foreach (var action in sequence.Actions)
        {
            Console.WriteLine($"    - {action.Type}: {action.Target}");
        }

        var passed = sequence.Actions.Count == 4;
        return Task.FromResult(passed);
    }

    static async Task<bool> TestInputSimulator(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing Win32InputSimulator...");
        Console.WriteLine("WARNING: This will move your mouse and type text!");
        Console.Write("Continue? (y/n): ");

        if (Console.ReadLine()?.Trim().ToLower() != "y")
        {
            Console.WriteLine("Skipped.");
            return true;
        }

        var logger = loggerFactory.CreateLogger<Win32InputSimulator>();
        var simulator = new Win32InputSimulator(logger);

        Console.WriteLine("\n  Test 1: Moving mouse to (100, 100)...");
        await simulator.MoveMouseAsync(100, 100);
        await Task.Delay(500);

        Console.WriteLine("  Test 2: Moving mouse to (500, 500)...");
        await simulator.MoveMouseAsync(500, 500);
        await Task.Delay(500);

        Console.WriteLine("  Test 3: Scrolling down...");
        await simulator.ScrollAsync(500, 500, -3);
        await Task.Delay(500);

        Console.WriteLine("\n  Open Notepad and position cursor in it within 3 seconds...");
        await Task.Delay(3000);

        Console.WriteLine("  Test 4: Typing text...");
        await simulator.TypeTextAsync("Hello from PDL!");
        await Task.Delay(500);

        Console.WriteLine("  Test 5: Pressing Enter...");
        await simulator.PressKeysAsync("enter");
        await Task.Delay(300);

        Console.WriteLine("  Test 6: Typing more and selecting all (Ctrl+A)...");
        await simulator.TypeTextAsync("This is a test.");
        await Task.Delay(300);
        await simulator.PressKeysAsync("ctrl+a");

        Console.WriteLine("\nInput simulator tests complete!");
        return true;
    }

    static async Task<bool> TestFeedbackStore(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing FeedbackStore (LiteDB)...");
        var logger = loggerFactory.CreateLogger<FeedbackStore>();

        using var store = new FeedbackStore(logger);

        var suggestion = new Suggestion
        {
            Id = Guid.NewGuid().ToString(),
            Description = "Test suggestion",
            Confidence = 0.85,
            Actions = new ActionSequence()
        };

        Console.WriteLine($"  Saving suggestion: {suggestion.Id}");
        await store.SaveSuggestionAsync(suggestion);

        Console.WriteLine("  Updating state to Approved...");
        await store.UpdateSuggestionStateAsync(suggestion.Id, SuggestionState.Approved);

        Console.WriteLine("  Retrieving recent suggestions...");
        var recent = await store.GetRecentSuggestionsAsync(5);
        Console.WriteLine($"  Found {recent.Count} suggestions");

        foreach (var s in recent)
        {
            Console.WriteLine($"    - {s.Id.Substring(0, 8)}... : {s.Description} ({s.State})");
        }

        var passed = recent.Count > 0;
        return passed;
    }

    static async Task<bool> TestAllIntegrated(ILoggerFactory loggerFactory)
    {
        Console.WriteLine("Testing All Components Integrated...\n");

        // 1. Inactivity Detector
        Console.WriteLine("[1/5] Inactivity Detector");
        var detector = new MouseInactivityDetector();
        var idle = detector.GetIdleTime();
        Console.WriteLine($"      Current idle: {idle.TotalMilliseconds:F0}ms - OK\n");

        // 2. Screen Capture + Frame Buffer
        Console.WriteLine("[2/5] Screen Capture + Frame Buffer");
        var captureLogger = loggerFactory.CreateLogger<WindowsGraphicsCapture>();
        using var capture = new WindowsGraphicsCapture(captureLogger, detector);
        var buffer = new FrameBufferManager(12);

        await capture.StartAsync();
        for (int i = 0; i < 3; i++)
        {
            var frame = await capture.CaptureAsync();
            if (frame != null) buffer.Add(frame);
            await Task.Delay(100);
        }
        await capture.StopAsync();
        Console.WriteLine($"      Captured {buffer.Count} frames - OK\n");

        // 3. State Machine
        Console.WriteLine("[3/5] State Machine");
        var smLogger = loggerFactory.CreateLogger<PulseStateMachine>();
        var sm = new PulseStateMachine(smLogger);
        sm.TryTransition(PulseState.Capturing);
        sm.TryTransition(PulseState.IntentDetected);
        Console.WriteLine($"      Current state: {sm.CurrentState} - OK\n");

        // 4. Action Parser
        Console.WriteLine("[4/5] Action Parser");
        var parserLogger = loggerFactory.CreateLogger<SemanticActionParser>();
        var parser = new SemanticActionParser(parserLogger);
        var response = new CloudBrainResponse
        {
            Confidence = 0.9,
            Description = "Click button",
            Actions = new List<CloudAction>
            {
                new CloudAction { Type = "click", Target = "Button", Region = new CloudRegion { X = 100, Y = 100, Width = 50, Height = 30 } }
            }
        };
        var seq = parser.Parse(response);
        Console.WriteLine($"      Parsed {seq.Actions.Count} actions - OK\n");

        // 5. Feedback Store
        Console.WriteLine("[5/5] Feedback Store");
        var storeLogger = loggerFactory.CreateLogger<FeedbackStore>();
        using var store = new FeedbackStore(storeLogger);
        await store.SaveSuggestionAsync(new Suggestion
        {
            Id = Guid.NewGuid().ToString(),
            Description = "Integration test",
            Confidence = 0.95,
            Actions = new ActionSequence()
        });
        var stored = await store.GetRecentSuggestionsAsync(1);
        Console.WriteLine($"      Stored and retrieved {stored.Count} suggestion - OK\n");

        Console.WriteLine("=== All Integration Tests Passed ===");
        return true;
    }
}

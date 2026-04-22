namespace PredictiveDesktopLayer.Domain.Interfaces;

public interface IInputSimulator
{
    Task ClickAsync(int x, int y, CancellationToken cancellationToken = default);
    Task RightClickAsync(int x, int y, CancellationToken cancellationToken = default);
    Task DoubleClickAsync(int x, int y, CancellationToken cancellationToken = default);
    Task TypeTextAsync(string text, CancellationToken cancellationToken = default);
    Task PressKeysAsync(string keys, CancellationToken cancellationToken = default);
    Task DragAsync(int startX, int startY, int endX, int endY, CancellationToken cancellationToken = default);
    Task ScrollAsync(int x, int y, int amount, CancellationToken cancellationToken = default);
    Task MoveMouseAsync(int x, int y, CancellationToken cancellationToken = default);
}

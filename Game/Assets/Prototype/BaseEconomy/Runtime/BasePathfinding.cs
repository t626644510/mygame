using System;

namespace Prototype.BaseEconomy
{
    /// <summary>Deterministic shortest paths over a four-direction, unit-cost grid.</summary>
    public static class BasePathfinding
    {
        /// <summary>
        /// Returns a shortest path including both endpoints, or an empty array if unreachable.
        /// Cells use the row-major index y * width + x. Equal-length paths follow FIFO
        /// discovery with neighbors ordered +x, -x, +y, -y and keep the first parent.
        /// On an unobstructed map this walks along x before y.
        /// </summary>
        /// <exception cref="ArgumentException">
        /// Dimensions, blocked cells, or either endpoint are invalid. A dimension product
        /// overflow is retained as the inner exception.
        /// </exception>
        public static GridPosition[] FindPath(int width, int height, bool[] blocked,
                                              GridPosition from, GridPosition to)
        {
            int cellCount = ValidateMap(width, height, blocked);
            int fromIndex = ValidatePosition(width, height, blocked, from, nameof(from));
            int toIndex = ValidatePosition(width, height, blocked, to, nameof(to));

            if (fromIndex == toIndex)
                return new[] { from };

            int[] parents = new int[cellCount];
            int[] distances = Search(width, height, blocked, fromIndex, toIndex, parents);
            if (distances[toIndex] < 0)
                return Array.Empty<GridPosition>();

            GridPosition[] path = new GridPosition[distances[toIndex] + 1];
            int current = toIndex;
            for (int i = path.Length - 1; i >= 0; i--)
            {
                path[i] = new GridPosition(current % width, current / width);
                if (i > 0)
                    current = parents[current];
            }

            return path;
        }

        /// <summary>
        /// Returns row-major shortest distances from a traversable source: the source is
        /// zero, and blocked or unreachable cells are -1. Discovery uses +x, -x, +y, -y.
        /// </summary>
        /// <exception cref="ArgumentException">
        /// Dimensions, blocked cells, or the source are invalid. A dimension product
        /// overflow is retained as the inner exception.
        /// </exception>
        public static int[] DistanceField(int width, int height, bool[] blocked,
                                          GridPosition from)
        {
            ValidateMap(width, height, blocked);
            int fromIndex = ValidatePosition(width, height, blocked, from, nameof(from));
            return Search(width, height, blocked, fromIndex, -1, null);
        }

        private static int ValidateMap(int width, int height, bool[] blocked)
        {
            if (width <= 0)
                throw new ArgumentException("Map width must be positive.", nameof(width));
            if (height <= 0)
                throw new ArgumentException("Map height must be positive.", nameof(height));
            if (blocked == null)
                throw new ArgumentException("Blocked cells must be provided.", nameof(blocked));

            int cellCount;
            try
            {
                cellCount = checked(width * height);
            }
            catch (OverflowException exception)
            {
                throw new ArgumentException("Map dimensions exceed the index range.",
                                            nameof(width), exception);
            }

            if (blocked.Length != cellCount)
                throw new ArgumentException("Blocked cell count must equal width * height.",
                                            nameof(blocked));

            return cellCount;
        }

        private static int ValidatePosition(int width, int height, bool[] blocked,
                                            GridPosition position, string parameterName)
        {
            if (position.x < 0 || position.x >= width ||
                position.y < 0 || position.y >= height)
                throw new ArgumentException("Position must be inside the map.", parameterName);

            int index = position.y * width + position.x;
            if (blocked[index])
                throw new ArgumentException("Position must be traversable.", parameterName);

            return index;
        }

        private static int[] Search(int width, int height, bool[] blocked,
                                    int fromIndex, int stopIndex, int[] parents)
        {
            int[] distances = new int[blocked.Length];
            Array.Fill(distances, -1);
            int[] queue = new int[blocked.Length];
            int head = 0;
            int tail = 0;
            distances[fromIndex] = 0;
            if (parents != null)
                parents[fromIndex] = fromIndex;
            queue[tail++] = fromIndex;

            while (head < tail && (stopIndex < 0 || distances[stopIndex] < 0))
            {
                int current = queue[head++];
                int x = current % width;
                int y = current / width;

                // Each cell is enqueued once; discovery fixes its distance and parent.
                if (x < width - 1)
                    Discover(current + 1, current, blocked, distances, parents, queue, ref tail);
                if (x > 0)
                    Discover(current - 1, current, blocked, distances, parents, queue, ref tail);
                if (y < height - 1)
                    Discover(current + width, current, blocked, distances, parents, queue, ref tail);
                if (y > 0)
                    Discover(current - width, current, blocked, distances, parents, queue, ref tail);
            }

            return distances;
        }

        private static void Discover(int neighbor, int current, bool[] blocked,
                                     int[] distances, int[] parents, int[] queue, ref int tail)
        {
            if (blocked[neighbor] || distances[neighbor] >= 0)
                return;

            distances[neighbor] = distances[current] + 1;
            if (parents != null)
                parents[neighbor] = current;
            queue[tail++] = neighbor;
        }
    }
}

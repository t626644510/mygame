using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace Prototype.BaseEconomy.Tests
{
    public sealed class BasePathfindingTests
    {
        [Test]
        public void Empty10By5MatchesLegacyMoveTowardForAll2500OrderedPairs()
        {
            const int width = 10;
            const int height = 5;
            bool[] blocked = new bool[width * height];
            int pairs = 0;
            int sameCellPairs = 0;

            // Every direction is called independently; no forward path is reversed or reused.
            for (int fromY = 0; fromY < height; fromY++)
            for (int fromX = 0; fromX < width; fromX++)
            {
                GridPosition from = new GridPosition(fromX, fromY);
                int[] field = BasePathfinding.DistanceField(width, height, blocked, from);
                Assert.That(field.Length, Is.EqualTo(width * height));
                Assert.That(BasePathfinding.DistanceField(width, height, blocked, from), Is.EqualTo(field));

                for (int toY = 0; toY < height; toY++)
                for (int toX = 0; toX < width; toX++)
                {
                    GridPosition to = new GridPosition(toX, toY);
                    GridPosition[] expected = LegacyMoveTowardPath(from, to);
                    GridPosition[] actual = BasePathfinding.FindPath(width, height, blocked, from, to);
                    string context = from + " -> " + to;
                    AssertPath(expected, actual, context);
                    AssertPath(actual, BasePathfinding.FindPath(width, height, blocked, from, to),
                        context + " repeated call");
                    Assert.That(field[toY * width + toX], Is.EqualTo(actual.Length - 1), context);
                    pairs++;
                    if (from == to) sameCellPairs++;
                }
            }

            Assert.That(pairs, Is.EqualTo(2500));
            Assert.That(sameCellPairs, Is.EqualTo(50));
            Assert.That(blocked, Is.EqualTo(new bool[width * height]), "Search must not modify the map.");
        }

        [TestCase(1)]
        [TestCase(2)]
        [TestCase(3)]
        [TestCase(4)]
        [TestCase(5)]
        public void FixedObstaclesHaveFrozenPathsAndRowMajorDistanceFields(int example)
        {
            FixedMap map = GetFixedMap(example);
            bool[] blocked = map.Blocked();
            bool[] before = (bool[])blocked.Clone();
            GridPosition[] path = BasePathfinding.FindPath(map.Width, map.Height, blocked, map.From, map.To);
            int[] field = BasePathfinding.DistanceField(map.Width, map.Height, blocked, map.From);

            AssertPath(map.ExpectedPath, path, map.Name);
            Assert.That(field, Is.EqualTo(map.ExpectedField), map.Name + " row-major field");
            AssertPath(path, BasePathfinding.FindPath(map.Width, map.Height, blocked, map.From, map.To),
                map.Name + " repeated path");
            Assert.That(BasePathfinding.DistanceField(map.Width, map.Height, blocked, map.From),
                Is.EqualTo(field), map.Name + " repeated field");

            for (int y = 0; y < map.Height; y++)
            for (int x = 0; x < map.Width; x++)
            {
                int index = y * map.Width + x;
                GridPosition to = new GridPosition(x, y);
                if (blocked[index])
                {
                    Assert.That(field[index], Is.EqualTo(-1));
                    continue;
                }

                GridPosition[] toCell = BasePathfinding.FindPath(map.Width, map.Height, blocked, map.From, to);
                int distance = toCell.Length == 0 ? -1 : toCell.Length - 1;
                Assert.That(distance, Is.EqualTo(map.ExpectedField[index]), map.Name + " -> " + to);
                AssertValidPath(toCell, map.Width, map.Height, blocked, map.From, to);
            }

            Assert.That(blocked, Is.EqualTo(before), map.Name + " input map");
        }

        [TestCase(1, 1)]
        [TestCase(1, 7)]
        [TestCase(7, 1)]
        public void SingleCellAndSingleAxisMapsIncludeBothEndpoints(int width, int height)
        {
            bool[] blocked = new bool[width * height];
            GridPosition from = new GridPosition(0, 0);
            GridPosition to = new GridPosition(width - 1, height - 1);
            AssertPath(LegacyMoveTowardPath(from, to),
                BasePathfinding.FindPath(width, height, blocked, from, to), "forward single-axis path");
            AssertPath(LegacyMoveTowardPath(to, from),
                BasePathfinding.FindPath(width, height, blocked, to, from), "independent reverse single-axis path");
            int[] field = BasePathfinding.DistanceField(width, height, blocked, from);
            for (int index = 0; index < field.Length; index++)
                Assert.That(field[index], Is.EqualTo(index));
        }

        [Test]
        public void NonemptyPathsAndDistanceFieldsAreIndependentAcrossCallsAndResultMutations()
        {
            bool[] blocked = new bool[6];
            GridPosition from = new GridPosition(0, 0);
            GridPosition to = new GridPosition(2, 1);
            GridPosition[] expected = LegacyMoveTowardPath(from, to);
            GridPosition[] first = BasePathfinding.FindPath(3, 2, blocked, from, to);
            GridPosition[] second = BasePathfinding.FindPath(3, 2, blocked, from, to);
            int[] firstField = BasePathfinding.DistanceField(3, 2, blocked, from);
            int[] secondField = BasePathfinding.DistanceField(3, 2, blocked, from);
            int[] expectedField = { 0, 1, 2, 1, 2, 3 };

            Assert.That(second, Is.Not.SameAs(first));
            Assert.That(secondField, Is.Not.SameAs(firstField));
            first[0] = new GridPosition(-100, -100);
            firstField[0] = -100;
            AssertPath(expected, second, "previous result after another result was mutated");
            Assert.That(secondField, Is.EqualTo(expectedField));
            AssertPath(expected, BasePathfinding.FindPath(3, 2, blocked, from, to), "fresh path after mutation");
            Assert.That(BasePathfinding.DistanceField(3, 2, blocked, from), Is.EqualTo(expectedField));

            // An unrelated map and later caller edits must not change earlier results or be cached.
            BasePathfinding.DistanceField(1, 1, new bool[1], new GridPosition(0, 0));
            blocked[0] = true;
            AssertPath(expected, second, "previous result after caller map mutation");
            Assert.That(secondField, Is.EqualTo(expectedField));
            AssertExactArgumentException(() => BasePathfinding.FindPath(3, 2, blocked, from, to));
            AssertExactArgumentException(() => BasePathfinding.DistanceField(3, 2, blocked, from));
            blocked[0] = false;
            AssertPath(expected, BasePathfinding.FindPath(3, 2, blocked, from, to), "restored caller map");
            Assert.That(blocked, Is.EqualTo(new bool[6]));
            Assert.That(from, Is.EqualTo(new GridPosition(0, 0)));
            Assert.That(to, Is.EqualTo(new GridPosition(2, 1)));
        }

        [Test]
        public void LegalSameCellReturnsOneIndependentPositionPerCall()
        {
            bool[] blocked = new bool[1];
            GridPosition origin = new GridPosition(0, 0);
            GridPosition[] first = BasePathfinding.FindPath(1, 1, blocked, origin, origin);
            GridPosition[] second = BasePathfinding.FindPath(1, 1, blocked, origin, origin);
            AssertPath(new[] { origin }, first, "same cell");
            Assert.That(second, Is.Not.SameAs(first));
            first[0] = new GridPosition(1, 1);
            AssertPath(new[] { origin }, second, "independent same-cell result");
            Assert.That(BasePathfinding.DistanceField(1, 1, blocked, origin), Is.EqualTo(new[] { 0 }));
        }

        [TestCase(0, 2)]
        [TestCase(-1, 2)]
        [TestCase(int.MinValue, 2)]
        [TestCase(2, 0)]
        [TestCase(2, -1)]
        [TestCase(2, int.MinValue)]
        public void NonpositiveDimensionsThrowExactlyArgumentException(int width, int height)
        {
            AssertInvalidMap(width, height, new bool[4]);
        }

        [Test]
        public void NullBlockedMapThrowsExactlyArgumentException()
        {
            AssertInvalidMap(2, 2, null);
        }

        [TestCase(0)]
        [TestCase(3)]
        [TestCase(5)]
        public void IncorrectBlockedLengthThrowsExactlyArgumentException(int length)
        {
            AssertInvalidMap(2, 2, new bool[length]);
        }

        [TestCase(int.MaxValue, 2)]
        [TestCase(2, int.MaxValue)]
        [TestCase(46341, 46341)]
        [TestCase(65536, 65536)]
        public void CheckedDimensionProductOverflowThrowsExactlyArgumentException(int width, int height)
        {
            bool[] blocked = new bool[1];
            GridPosition origin = new GridPosition(0, 0);
            ArgumentException pathError = Assert.Throws<ArgumentException>(() =>
                BasePathfinding.FindPath(width, height, blocked, origin, origin));
            ArgumentException fieldError = Assert.Throws<ArgumentException>(() =>
                BasePathfinding.DistanceField(width, height, blocked, origin));
            Assert.That(pathError.GetType(), Is.EqualTo(typeof(ArgumentException)));
            Assert.That(fieldError.GetType(), Is.EqualTo(typeof(ArgumentException)));
            Assert.That(pathError.InnerException, Is.TypeOf<OverflowException>());
            Assert.That(fieldError.InnerException, Is.TypeOf<OverflowException>());
            Assert.That(blocked, Is.EqualTo(new bool[1]));
        }

        [TestCase(-1, 0)]
        [TestCase(2, 0)]
        [TestCase(0, -1)]
        [TestCase(0, 2)]
        [TestCase(int.MinValue, 0)]
        [TestCase(int.MaxValue, 0)]
        [TestCase(0, int.MinValue)]
        [TestCase(0, int.MaxValue)]
        public void OutOfBoundsSourceAndDestinationThrowExactlyArgumentException(int x, int y)
        {
            bool[] blocked = new bool[4];
            GridPosition outside = new GridPosition(x, y);
            GridPosition inside = new GridPosition(0, 0);
            AssertExactArgumentException(() => BasePathfinding.FindPath(2, 2, blocked, outside, inside));
            AssertExactArgumentException(() => BasePathfinding.FindPath(2, 2, blocked, inside, outside));
            AssertExactArgumentException(() => BasePathfinding.FindPath(2, 2, blocked, outside, outside));
            AssertExactArgumentException(() => BasePathfinding.DistanceField(2, 2, blocked, outside));
            Assert.That(blocked, Is.EqualTo(new bool[4]));
        }

        [Test]
        public void BlockedSourceThrowsExactlyArgumentException()
        {
            bool[] blocked = { false, false, false, true };
            GridPosition source = new GridPosition(1, 1);
            AssertExactArgumentException(() => BasePathfinding.FindPath(2, 2, blocked, source, new GridPosition(0, 0)));
            AssertExactArgumentException(() => BasePathfinding.DistanceField(2, 2, blocked, source));
            Assert.That(blocked, Is.EqualTo(new[] { false, false, false, true }));
        }

        [Test]
        public void BlockedDestinationThrowsExactlyArgumentException()
        {
            bool[] blocked = { false, false, false, true };
            AssertExactArgumentException(() => BasePathfinding.FindPath(2, 2, blocked,
                new GridPosition(0, 0), new GridPosition(1, 1)));
            Assert.That(blocked, Is.EqualTo(new[] { false, false, false, true }));
        }

        [Test]
        public void BlockedSameCellIsInvalidBeforeTheSameCellShortcut()
        {
            bool[] blocked = { true };
            GridPosition origin = new GridPosition(0, 0);
            AssertExactArgumentException(() => BasePathfinding.FindPath(1, 1, blocked, origin, origin));
            AssertExactArgumentException(() => BasePathfinding.DistanceField(1, 1, blocked, origin));
            Assert.That(blocked[0], Is.True);
        }

        [TestCase(3, 2, 3, 1, 3, 7)]
        [TestCase(8, 7, 8, 1, 3, 17)]
        [TestCase(3, 2, 3, 2, 4, 12)]
        [TestCase(8, 7, 8, 2, 4, 32)]
        public void FirstMealDistancesUseEdgeCountForMovementTicks(int kitchenX, int supplierTiles,
            int customerTiles, int movementTicksPerTile, int productionTicks, int firstMealTick)
        {
            bool[] blocked = new bool[50];
            GridPosition kitchen = new GridPosition(kitchenX, 2);
            GridPosition supplier = new GridPosition(1, 2);
            GridPosition customer = new GridPosition(0, 2);
            GridPosition[] supplierPath = BasePathfinding.FindPath(10, 5, blocked, kitchen, supplier);
            GridPosition[] customerPath = BasePathfinding.FindPath(10, 5, blocked, customer, kitchen);
            int supplierMovementTicks = (supplierPath.Length - 1) * movementTicksPerTile;
            int customerMovementTicks = (customerPath.Length - 1) * movementTicksPerTile;
            int[] fromKitchen = BasePathfinding.DistanceField(10, 5, blocked, kitchen);

            Assert.That(supplierPath.Length - 1, Is.EqualTo(supplierTiles));
            Assert.That(customerPath.Length - 1, Is.EqualTo(customerTiles));
            Assert.That(fromKitchen[supplier.y * 10 + supplier.x], Is.EqualTo(supplierTiles));
            Assert.That(fromKitchen[customer.y * 10 + customer.x], Is.EqualTo(customerTiles));
            Assert.That(supplierMovementTicks, Is.EqualTo(supplierTiles * movementTicksPerTile));
            Assert.That(customerMovementTicks, Is.EqualTo(customerTiles * movementTicksPerTile));
            Assert.That(Math.Max(2 * supplierMovementTicks + productionTicks, customerMovementTicks),
                Is.EqualTo(firstMealTick));
        }

        private static void AssertInvalidMap(int width, int height, bool[] blocked)
        {
            bool[] before = blocked == null ? null : (bool[])blocked.Clone();
            GridPosition origin = new GridPosition(0, 0);
            AssertExactArgumentException(() => BasePathfinding.FindPath(width, height, blocked, origin, origin));
            AssertExactArgumentException(() => BasePathfinding.DistanceField(width, height, blocked, origin));
            if (blocked != null) Assert.That(blocked, Is.EqualTo(before));
        }

        private static void AssertExactArgumentException(TestDelegate action)
        {
            ArgumentException error = Assert.Throws<ArgumentException>(action);
            Assert.That(error.GetType(), Is.EqualTo(typeof(ArgumentException)), "Derived argument errors are not the API contract.");
        }

        private static GridPosition[] LegacyMoveTowardPath(GridPosition from, GridPosition to)
        {
            // Mirrors only the existing BaseSession.MoveToward tile update, not the new search.
            List<GridPosition> result = new List<GridPosition> { from };
            while (from != to)
            {
                if (from.x != to.x) from.x += Math.Sign(to.x - from.x);
                else from.y += Math.Sign(to.y - from.y);
                result.Add(from);
            }
            return result.ToArray();
        }

        private static void AssertPath(GridPosition[] expected, GridPosition[] actual, string context)
        {
            Assert.That(actual, Is.Not.Null, context);
            Assert.That(actual.Length, Is.EqualTo(expected.Length), context + " length");
            for (int i = 0; i < expected.Length; i++)
                Assert.That(actual[i], Is.EqualTo(expected[i]), context + " cell " + i);
        }

        private static void AssertValidPath(GridPosition[] path, int width, int height, bool[] blocked,
            GridPosition from, GridPosition to)
        {
            if (path.Length == 0) return;
            Assert.That(path[0], Is.EqualTo(from));
            Assert.That(path[path.Length - 1], Is.EqualTo(to));
            for (int i = 0; i < path.Length; i++)
            {
                Assert.That(path[i].x, Is.InRange(0, width - 1));
                Assert.That(path[i].y, Is.InRange(0, height - 1));
                Assert.That(blocked[path[i].y * width + path[i].x], Is.False);
                if (i > 0) Assert.That(path[i - 1].ManhattanDistance(path[i]), Is.EqualTo(1));
            }
        }

        private static GridPosition[] Positions(params int[] xy)
        {
            GridPosition[] result = new GridPosition[xy.Length / 2];
            for (int i = 0; i < result.Length; i++) result[i] = new GridPosition(xy[2 * i], xy[2 * i + 1]);
            return result;
        }

        private static FixedMap GetFixedMap(int example)
        {
            switch (example)
            {
                case 1:
                    return new FixedMap("single-block symmetric detour", new[] { ".....", "..#..", "....." },
                        new GridPosition(0, 1), new GridPosition(4, 1),
                        Positions(0, 1, 1, 1, 1, 2, 2, 2, 3, 2, 4, 2, 4, 1),
                        new[] { 1, 2, 3, 4, 5, 0, 1, -1, 5, 6, 1, 2, 3, 4, 5 });
                case 2:
                    return new FixedMap("bottom opening", new[] { "..#..", "..#..", "..#..", "....." },
                        new GridPosition(0, 1), new GridPosition(4, 1),
                        Positions(0, 1, 1, 1, 1, 2, 1, 3, 2, 3, 3, 3, 4, 3, 4, 2, 4, 1),
                        new[] { 1, 2, -1, 8, 9, 0, 1, -1, 7, 8, 1, 2, -1, 6, 7, 2, 3, 4, 5, 6 });
                case 3:
                    return new FixedMap("complete wall", new[] { "..#..", "..#..", "..#.." },
                        new GridPosition(0, 1), new GridPosition(4, 1), new GridPosition[0],
                        new[] { 1, 2, -1, -1, -1, 0, 1, -1, -1, -1, 1, 2, -1, -1, -1 });
                case 4:
                    return new FixedMap("legal target surrounded by four obstacles", new[] { ".#.", "#.#", ".#." },
                        new GridPosition(0, 0), new GridPosition(1, 1), new GridPosition[0],
                        new[] { 0, -1, -1, -1, -1, -1, -1, -1, -1 });
                case 5:
                    return new FixedMap("dead-end branch", new[] { "S#..T", ".#.##", ".#...", "...#.", "#####" },
                        new GridPosition(0, 0), new GridPosition(4, 0),
                        Positions(0, 0, 0, 1, 0, 2, 0, 3, 1, 3, 2, 3, 2, 2, 2, 1, 2, 0, 3, 0, 4, 0),
                        new[] { 0, -1, 8, 9, 10, 1, -1, 7, -1, -1, 2, -1, 6, 7, 8, 3, 4, 5, -1, 9, -1, -1, -1, -1, -1 });
                default:
                    throw new ArgumentException("Unknown fixed obstacle example.", "example");
            }
        }

        private sealed class FixedMap
        {
            public readonly string Name;
            public readonly string[] Rows;
            public readonly GridPosition From;
            public readonly GridPosition To;
            public readonly GridPosition[] ExpectedPath;
            public readonly int[] ExpectedField;
            public int Width { get { return Rows[0].Length; } }
            public int Height { get { return Rows.Length; } }

            public FixedMap(string name, string[] rows, GridPosition from, GridPosition to,
                GridPosition[] expectedPath, int[] expectedField)
            {
                Name = name;
                Rows = rows;
                From = from;
                To = to;
                ExpectedPath = expectedPath;
                ExpectedField = expectedField;
            }

            public bool[] Blocked()
            {
                bool[] result = new bool[Width * Height];
                for (int y = 0; y < Height; y++)
                for (int x = 0; x < Width; x++) result[y * Width + x] = Rows[y][x] == '#';
                return result;
            }
        }
    }
}

import { Request, Response, NextFunction } from 'express'
import { Book, BookHistory, BookRating, BookReview, User } from '../../db/models'
import { httpErrorMessageConstant, httpStatusConstant, messageConstant } from '../../constant'
import { Controller } from '../../interfaces'
import { responseHandlerUtils } from '../../utils'
import { getRatingService, getReviewService } from '../../services/book'
import { HttpError } from '../../types/error'

/**
 * @description Searches for active books by name, ID, or both (returns details & aggregates).
 */
const searchBooks: Controller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, bookID, page, pageSize } = req.query
    const pageNumber = Number(page) || 1
    const limit = Number(pageSize) || 10
    const skip = (pageNumber - 1) * limit

    const searchQuery: { deletedAt: Date | null } & {
      $or?: { bookID?: string; name?: RegExp }[]
    } = {
      deletedAt: null
    }

    if (bookID || name) {
      searchQuery.$or = []
      if (bookID) searchQuery.$or.push({ bookID: String(bookID) })
      if (name) searchQuery.$or.push({ name: new RegExp(name as string, 'i') })
    }

    const totalBooks = await Book.countDocuments({ deletedAt: null })
    if (!totalBooks) {
      throw new HttpError(
        messageConstant.ERROR_COUNTING_BOOKS,
        httpStatusConstant.INTERNAL_SERVER_ERROR
      )
    }

    if (pageNumber > Math.ceil(totalBooks / limit)) {
      throw new HttpError(messageConstant.INVALID_PAGE_NUMBER, httpStatusConstant.BAD_REQUEST)
    }

    const searchPipeline = [
      { $match: searchQuery },
      {
        $lookup: {
          from: 'bookgalleries',
          let: { bookID: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$bookID', '$$bookID'] }, { $eq: ['$imageName', 'coverImage'] }]
                }
              }
            }
          ],
          as: 'coverImage'
        }
      },
      {
        $lookup: {
          from: 'bookratings',
          localField: '_id',
          foreignField: 'bookID',
          as: 'ratings'
        }
      },
      {
        $lookup: {
          from: 'bookreviews',
          localField: '_id',
          foreignField: 'bookID',
          as: 'reviews'
        }
      },
      {
        $addFields: {
          rating: { $avg: '$ratings.rating' },
          reviewCount: { $size: '$reviews' },
          publishYear: { $year: '$publishedDate' }
        }
      },
      {
        $project: {
          bookID: 1,
          name: 1,
          author: 1,
          stock: '$quantityAvailable',
          rating: { $ifNull: ['$rating', 0] },
          reviewCount: 1,
          publishYear: 1,
          coverImage: 1
        }
      },
      { $skip: skip },
      { $limit: limit }
    ]

    const searchedBooks = await Book.aggregate(searchPipeline)
    if (!searchedBooks.length) {
      throw new HttpError(messageConstant.BOOK_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      data: {
        searchedBooks,
        pagination: {
          page: pageNumber,
          pageSize: limit,
          totalPages: Math.ceil(totalBooks / limit)
        }
      }
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Retrieves detailed information for all active books.
 */
const getAllBookDetails: Controller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const totalBooks = await Book.countDocuments({ deletedAt: null })
    if (!totalBooks) {
      throw new HttpError(
        messageConstant.ERROR_COUNTING_BOOKS,
        httpStatusConstant.INTERNAL_SERVER_ERROR
      )
    }

    const searchPipeline = [
      { $match: { deletedAt: null } },
      {
        $lookup: {
          from: 'bookgalleries',
          let: { bookID: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$bookID', '$$bookID'] }, { $eq: ['$imageName', 'coverImage'] }]
                }
              }
            }
          ],
          as: 'coverImage'
        }
      },
      {
        $lookup: {
          from: 'bookratings',
          localField: '_id',
          foreignField: 'bookID',
          as: 'ratings'
        }
      },
      {
        $lookup: {
          from: 'bookreviews',
          localField: '_id',
          foreignField: 'bookID',
          as: 'reviews'
        }
      },
      {
        $lookup: {
          from: 'bookgalleries',
          localField: '_id',
          foreignField: 'bookID',
          as: 'gallery'
        }
      },
      {
        $addFields: {
          rating: { $avg: '$ratings.rating' },
          reviewCount: { $size: '$reviews' }
        }
      },
      {
        $project: {
          _id: 0,
          bookID: 1,
          name: 1,
          author: 1,
          stock: '$quantityAvailable',
          publishedDate: 1,
          coverImage: 1,
          gallery: 1,
          rating: 1,
          reviews: 1,
          reviewCount: 1
        }
      }
    ]

    const books = await Book.aggregate(searchPipeline)
    if (!books.length) {
      throw new HttpError(messageConstant.BOOK_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      data: {
        books,
        totalBooks
      }
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Allows a user to write a review for a book (prevents duplicates).
 */
const addBookReview: Controller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params
    const { bookID, review } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      throw new HttpError(messageConstant.USER_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const book = await Book.findOne({ bookID })
    if (!book) {
      throw new HttpError(messageConstant.BOOK_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const existingReview = await BookReview.findOne({ userID: user._id, bookID: book._id })
    if (existingReview) {
      throw new HttpError(messageConstant.REVIEW_ALREADY_EXIST, httpStatusConstant.BAD_REQUEST)
    }

    const newReview = await BookReview.create({ userID: user._id, bookID: book._id, review })
    if (!newReview) {
      throw new HttpError(
        messageConstant.ERROR_CREATING_BOOK_REVIEW,
        httpStatusConstant.INTERNAL_SERVER_ERROR
      )
    }
    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      message: httpErrorMessageConstant.SUCCESSFUL
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Allows a user to rate a book (prevents duplicates).
 */
const addBookRating: Controller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params
    const { bookID, rating } = req.body

    const user = await User.findOne({ email })
    if (!user) {
      throw new HttpError(messageConstant.USER_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const book = await Book.findOne({ bookID })
    if (!book) {
      throw new HttpError(messageConstant.BOOK_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const existingRating = await BookRating.findOne({ userID: user._id, bookID: book._id })
    if (existingRating) {
      throw new HttpError(messageConstant.RATING_ALREADY_EXIST, httpStatusConstant.BAD_REQUEST)
    }

    const newRating = await BookRating.create({ userID: user._id, bookID: book._id, rating })
    if (!newRating) {
      throw new HttpError(
        messageConstant.ERROR_CREATING_BOOK_RATING,
        httpStatusConstant.INTERNAL_SERVER_ERROR
      )
    }

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      message: httpErrorMessageConstant.SUCCESSFUL
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Retrieves detailed history of book issuance and returns (includes user info).
 */
const getBookIssueHistory: Controller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params

    const user = await User.findOne({ email })
    if (!user) {
      throw new HttpError(messageConstant.USER_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const bookHistories = await BookHistory.find({ userID: user._id }).populate({
      path: 'userID bookID',
      select: 'email firstname lastname bookID name charges'
    })

    if (!bookHistories || bookHistories.length === 0) {
      throw new HttpError(messageConstant.BOOK_HISTORY_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const formattedHistories = bookHistories.map((history: any) => {
      const issueDate = new Date(history.issueDate)
      const submitDate = history.submitDate ? new Date(history.submitDate) : null
      const usedDays = submitDate
        ? Math.ceil((submitDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24))
        : null
      const totalAmount = submitDate ? (usedDays || 0) * history.bookID.charges : null

      return {
        issueDate,
        submitDate,
        usedDays,
        totalAmount
      }
    })

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      data: {
        bookHistories: formattedHistories
      }
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Provides overall library statistics (issued, submitted, charges etc.) of a user.
 */
const getLibrarySummary: Controller = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.params
    const user = await User.findOne({ email }, { _id: 1, paidAmount: 1, dueCharges: 1 })
    if (!user) {
      throw new HttpError(messageConstant.USER_NOT_FOUND, httpStatusConstant.NOT_FOUND)
    }

    const totalIssuedBooks = await BookHistory.countDocuments({ userID: user._id })
    const totalSubmittedBooks = await BookHistory.countDocuments({
      userID: user._id,
      submitDate: { $exists: true, $ne: null }
    })

    if (totalIssuedBooks === undefined || totalSubmittedBooks === undefined) {
      throw new HttpError(
        messageConstant.ERROR_COUNTING_BOOK_HISTORY,
        httpStatusConstant.INTERNAL_SERVER_ERROR
      )
    }

    const totalNotSubmittedBooks = totalIssuedBooks - totalSubmittedBooks

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      data: {
        totalIssuedBooks,
        totalSubmittedBooks,
        totalNotSubmittedBooks,
        totalPaidAmount: user.paidAmount,
        totalDueCharges: user.dueCharges
      }
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Retrieves overall ratings summary of a specific book.
 */
const getBookRatingsSummary: Controller = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { bookID } = req.params

    const ratingsSummary = await getRatingService.getRatings(Number(bookID))
    if (!ratingsSummary) {
      throw new HttpError(messageConstant.NO_RATINGS_FOUND, httpStatusConstant.NOT_FOUND)
    }

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      data: ratingsSummary
    })
  } catch (error) {
    return next(error)
  }
}

/**
 * @description Retrieves overall reviews summary of a specific book.
 */
const getBookReviewsSummary: Controller = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { bookID } = req.params
    const { page = 1, pageSize = 10 } = req.query
    const pageNumber = Number(page)
    const limit = Number(pageSize)
    const skip = (pageNumber - 1) * limit

    const totalReviews = await getReviewService.getReviewsCount(Number(bookID))
    const totalPages = Math.ceil(totalReviews / limit)

    if (pageNumber > totalPages) {
      throw new HttpError(messageConstant.INVALID_PAGE_NUMBER, httpStatusConstant.BAD_REQUEST)
    }

    const reviews = await getReviewService.getReviews(Number(bookID), skip, limit)

    if (!reviews || reviews.length === 0) {
      throw new HttpError(messageConstant.NO_REVIEWS_FOUND, httpStatusConstant.NOT_FOUND)
    }

    return responseHandlerUtils.responseHandler(res, {
      statusCode: httpStatusConstant.OK,
      data: {
        reviews: reviews.bookReviews,
        pagination: {
          page: pageNumber,
          pageSize: limit,
          totalPages
        }
      },
      message: httpErrorMessageConstant.SUCCESSFUL
    })
  } catch (error) {
    return next(error)
  }
}

export default {
  searchBooks,
  getAllBookDetails,
  addBookReview,
  addBookRating,
  getBookIssueHistory,
  getLibrarySummary,
  getBookRatingsSummary,
  getBookReviewsSummary
}
